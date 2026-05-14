import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  NgZone,
  OnDestroy,
  runInInjectionContext,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';

import {
  ArcType,
  buildModuleUrl,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  ClockRange,
  ClockStep,
  Color,
  ConstantProperty,
  ExtrapolationType,
  HeightReference,
  ImageryLayer,
  JulianDate,
  LabelStyle,
  LagrangePolynomialApproximation,
  NearFarScalar,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  SampledPositionProperty,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium';

import { SatelliteService } from '../satellite.service';
import { PositionState, SatelliteApiResponse, PassSelection } from '../satellite.model';
import { PassesPanel } from '../passes-panel/passes-panel';

const SATELLITE_ICON = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <rect x="15" y="15" width="10" height="10" rx="2" fill="#4fc3f7"/>
  <rect x="2"  y="16" width="11" height="8"  rx="2" fill="#1565c0"/>
  <rect x="27" y="16" width="11" height="8"  rx="2" fill="#1565c0"/>
  <line x1="20" y1="15" x2="20" y2="7"  stroke="#90caf9" stroke-width="1.5"/>
  <circle cx="20" cy="5" r="3" fill="#90caf9"/>
</svg>`)}`;

const EXTRAPOLATION_WINDOW_S = 12;

@Component({
  selector: 'app-satellite-map',
  imports: [DecimalPipe, DatePipe, FormsModule, PassesPanel],
  templateUrl: './satellite-map.html',
  styleUrl: './satellite-map.scss',
})
export class SatelliteMap implements AfterViewInit, OnDestroy {
  @ViewChild('cesiumContainer', { static: true })
  private readonly containerRef!: ElementRef<HTMLDivElement>;

  private readonly service    = inject(SatelliteService);
  private readonly ngZone     = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector   = inject(Injector);

  readonly noradId      = signal(25544);
  readonly posState     = signal<PositionState>({ data: null, error: null, loading: true });
  readonly tracking     = signal(true);
  readonly cesiumError  = signal<string | null>(null);
  readonly selectedPass = signal<PassSelection | null>(null);

  private viewer!: Viewer;
  private sampledPos!: SampledPositionProperty;
  private groundSampledPos!: SampledPositionProperty;
  private firstSample = true;

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  ngAfterViewInit(): void {
    // ── Cesium init (outside Angular zone to avoid triggering CD at 60 fps)
    this.ngZone.runOutsideAngular(() => {
      try {
        this.initViewer();
        this.initSampledPosition();
        this.addSatelliteEntity();
        this.addGroundProjectionEntities();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[SatelliteMap] Cesium init error:', err);
        // Re-enter zone to update the signal → Angular re-renders the error banner
        this.ngZone.run(() => this.cesiumError.set(msg));
      }
    });

    // ── Polling: called here so it starts right after the viewer is ready.
    //    startPolling() wraps the reactive chain in runInInjectionContext
    //    to provide the component injector explicitly.
    this.startPolling();
  }

  ngOnDestroy(): void {
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cesium setup
  // ─────────────────────────────────────────────────────────────────────────

  private initViewer(): void {
    this.viewer = new Viewer(this.containerRef.nativeElement, {
      // Use the Natural Earth II tiles bundled inside CesiumJS itself.
      // No network request, no token, no async race condition.
      baseLayer: ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(
          buildModuleUrl('Assets/Textures/NaturalEarthII/'),
          { fileExtension: 'jpg' },
        ),
      ),
      // terrainProvider defaults to EllipsoidTerrainProvider — no need to set it
      baseLayerPicker:       false,
      geocoder:              false,
      homeButton:            false,
      infoBox:               false,
      navigationHelpButton:  false,
      sceneModePicker:       false,
      selectionIndicator:    false,
      timeline:              false,
      animation:             false,
      fullscreenButton:      false,
    });

    // Real-time wall-clock
    const now = JulianDate.now();
    this.viewer.clock.shouldAnimate = true;
    this.viewer.clock.multiplier    = 1;
    this.viewer.clock.clockRange    = ClockRange.UNBOUNDED;
    this.viewer.clock.clockStep     = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    this.viewer.clock.currentTime   = now.clone();

    this.viewer.scene.globe.depthTestAgainstTerrain = false;
  }

  private initSampledPosition(): void {
    this.sampledPos = new SampledPositionProperty();
    this.sampledPos.setInterpolationOptions({
      interpolationDegree:    5,
      interpolationAlgorithm: LagrangePolynomialApproximation,
    });
    this.sampledPos.forwardExtrapolationType     = ExtrapolationType.EXTRAPOLATE;
    this.sampledPos.forwardExtrapolationDuration = EXTRAPOLATION_WINDOW_S;

    this.groundSampledPos = new SampledPositionProperty();
    this.groundSampledPos.setInterpolationOptions({
      interpolationDegree:    5,
      interpolationAlgorithm: LagrangePolynomialApproximation,
    });
    this.groundSampledPos.forwardExtrapolationType     = ExtrapolationType.EXTRAPOLATE;
    this.groundSampledPos.forwardExtrapolationDuration = EXTRAPOLATION_WINDOW_S;
  }

  private addSatelliteEntity(): void {
    this.viewer.entities.add({
      id:       'satellite',
      position: this.sampledPos,
      billboard: {
        image:  SATELLITE_ICON,
        width:  36,
        height: 36,
        scaleByDistance:          new NearFarScalar(1.5e6, 1.2, 1.5e8, 0.5),
        heightReference:          HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text:         new ConstantProperty(''),
        font:         '13px "Segoe UI", sans-serif',
        fillColor:    Color.fromCssColorString('#e2e8f0'),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style:        LabelStyle.FILL_AND_OUTLINE,
        pixelOffset:  new Cartesian2(0, -30),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.5e6, 1.0, 1.5e8, 0.4),
      },
      path: {
        resolution: 1,
        trailTime:  600,
        leadTime:   0,
        width:      1.5,
        material: new PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Color.fromCssColorString('#38bdf860'),
        }),
      },
    });
  }

  private addGroundProjectionEntities(): void {
    this.viewer.entities.add({
      id: 'ground-projection',
      position: this.groundSampledPos,
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString('#38bdf8'),
        outlineColor: Color.fromCssColorString('#0c4a6e'),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.5e6, 1.2, 1.5e8, 0.4),
      },
    });

    this.viewer.entities.add({
      id: 'nadir-line',
      polyline: {
        positions: new CallbackProperty(() => {
          const now = JulianDate.now();
          const satPos = this.sampledPos.getValue(now);
          const gndPos = this.groundSampledPos.getValue(now);
          if (!satPos || !gndPos) return [];
          return [gndPos, satPos];
        }, false),
        width: 1.5,
        arcType: ArcType.NONE,
        material: new PolylineDashMaterialProperty({
          color: Color.fromCssColorString('#38bdf850'),
          dashLength: 16,
        }),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Polling
  // ─────────────────────────────────────────────────────────────────────────

  private startPolling(): void {
    // Provide the component injector explicitly so the effect inside
    // toObservable() is tied to this component's lifetime.
    runInInjectionContext(this.injector, () => {
      toObservable(this.noradId)
        .pipe(
          switchMap((id) => {
            this.ngZone.runOutsideAngular(() => this.resetTrajectory());
            this.ngZone.run(() =>
              this.posState.set({ data: null, error: null, loading: true }),
            );
            this.firstSample = true;
            return this.service.pollPosition(id);
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((state) => {
          this.ngZone.run(() => this.posState.set(state));
          if (state.data) {
            this.ngZone.runOutsideAngular(() => this.addSample(state.data!));
          }
        });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cesium updates
  // ─────────────────────────────────────────────────────────────────────────

  private resetTrajectory(): void {
    if (!this.viewer) return;
    this.initSampledPosition();
    const entity = this.viewer.entities.getById('satellite');
    if (entity) {
      entity.position = this.sampledPos as any;
      if (entity.label?.text instanceof ConstantProperty) {
        entity.label.text.setValue('');
      }
    }
    const groundEntity = this.viewer.entities.getById('ground-projection');
    if (groundEntity) {
      groundEntity.position = this.groundSampledPos as any;
    }
  }

  private addSample(data: SatelliteApiResponse): void {
    if (!this.viewer || !this.sampledPos) return;

    const time = JulianDate.fromDate(new Date(data.propagation.timestamp));
    const { x, y, z } = data.state.ecef.position_km;
    const position = new Cartesian3(x * 1000, y * 1000, z * 1000);

    this.sampledPos.addSample(time, position);

    const { lat_deg, lon_deg } = data.state.geodetic;
    this.groundSampledPos.addSample(time, Cartesian3.fromDegrees(lon_deg, lat_deg, 0));

    this.viewer.clock.currentTime = JulianDate.now();

    const entity = this.viewer.entities.getById('satellite');
    if (entity?.label?.text instanceof ConstantProperty) {
      entity.label.text.setValue(data.satellite.name);
    }

    if (this.firstSample) {
      this.firstSample = false;
      const entity = this.viewer.entities.getById('satellite');
      if (this.tracking() && entity) {
        // trackedEntity lets Cesium handle following; user can still orbit/zoom.
        this.viewer.trackedEntity = entity;
      } else {
        this.viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(
            data.state.geodetic.lon_deg,
            data.state.geodetic.lat_deg,
            data.state.geodetic.alt_km * 1000 + 4_000_000,
          ),
          duration: 2,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Template helpers
  // ─────────────────────────────────────────────────────────────────────────

  get geodetic()      { return this.posState().data?.state.geodetic ?? null; }
  get satelliteName() { return this.posState().data?.satellite.name  ?? null; }
  get lastUpdate() {
    const ts = this.posState().data?.propagation.timestamp;
    return ts ? new Date(ts) : null;
  }

  toggleTracking(): void {
    const next = !this.tracking();
    this.tracking.set(next);
    if (!this.viewer) return;
    if (next) {
      const entity = this.viewer.entities.getById('satellite');
      if (entity) this.viewer.trackedEntity = entity;
    } else {
      this.viewer.trackedEntity = undefined;
    }
  }

  onNoradChange(raw: string | number): void {
    const id = parseInt(String(raw), 10);
    if (!isNaN(id) && id > 0) this.noradId.set(id);
  }

  onPassSelected(sel: PassSelection | null): void {
    this.selectedPass.set(sel);
  }

  closePassDetail(): void {
    this.selectedPass.set(null);
  }

  private static readonly CARDINAL = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];

  azToCardinal(az: number): string {
    return SatelliteMap.CARDINAL[Math.round(az / 22.5) % 16]!;
  }

  formatDuration(s: number): string {
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  }

  passStatus(sel: PassSelection): 'upcoming' | 'active' | 'past' {
    const now  = Date.now();
    const rise = new Date(sel.pass.rise.time).getTime();
    const set  = new Date(sel.pass.set.time).getTime();
    if (now < rise) return 'upcoming';
    if (now <= set)  return 'active';
    return 'past';
  }

  countdown(sel: PassSelection): string {
    const now  = Date.now();
    const rise = new Date(sel.pass.rise.time).getTime();
    const set  = new Date(sel.pass.set.time).getTime();

    if (now < rise) {
      const diff = rise - now;
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      if (h > 0) return `en ${h}h ${m}m`;
      if (m > 0) return `en ${m}m ${s}s`;
      return `en ${s}s`;
    }
    if (now <= set) {
      const remaining = set - now;
      const m = Math.floor(remaining / 60_000);
      const s = Math.floor((remaining % 60_000) / 1_000);
      return m > 0 ? `termina en ${m}m ${s}s` : `termina en ${s}s`;
    }
    const elapsed = now - set;
    const h = Math.floor(elapsed / 3_600_000);
    const m = Math.floor((elapsed % 3_600_000) / 60_000);
    if (h > 0) return `hace ${h}h ${m}m`;
    return `hace ${m}m`;
  }

  elevationQuality(el: number): string {
    if (el >= 60) return 'excelente';
    if (el >= 30) return 'bueno';
    if (el >= 15) return 'bajo';
    return 'rasante';
  }
}

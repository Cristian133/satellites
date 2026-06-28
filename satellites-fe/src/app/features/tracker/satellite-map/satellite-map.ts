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
  Rectangle,
  SampledPositionProperty,
  SingleTileImageryProvider,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium';

import { twoline2satrec, propagate, gstime, eciToEcf, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';

import { SatelliteService } from '../../../core/services/satellite.service';
import { PositionState, SatelliteState, PassSelection } from '../../../core/models/satellite.model';
import { PassesPanel } from '../passes-panel/passes-panel';
import { SatelliteSearch } from '../satellite-search/satellite-search';
import { PerformanceOverlay } from '../performance-overlay/performance-overlay';
import { SatelliteRadar } from '../satellite-radar/satellite-radar';

const SATELLITE_ICON = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <rect x="15" y="15" width="10" height="10" rx="2" fill="#4fc3f7"/>
  <rect x="2"  y="16" width="11" height="8"  rx="2" fill="#1565c0"/>
  <rect x="27" y="16" width="11" height="8"  rx="2" fill="#1565c0"/>
  <line x1="20" y1="15" x2="20" y2="7"  stroke="#90caf9" stroke-width="1.5"/>
  <circle cx="20" cy="5" r="3" fill="#90caf9"/>
</svg>`)}`;

const SUN_ICON = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="7" fill="#fbbf24"/>
  <g stroke="#fbbf24" stroke-width="2.2" stroke-linecap="round" opacity="0.75">
    <line x1="16" y1="2"  x2="16" y2="6"/>  <line x1="16" y1="26" x2="16" y2="30"/>
    <line x1="2"  y1="16" x2="6"  y2="16"/> <line x1="26" y1="16" x2="30" y2="16"/>
    <line x1="6"  y1="6"  x2="9"  y2="9"/>  <line x1="23" y1="23" x2="26" y2="26"/>
    <line x1="26" y1="6"  x2="23" y2="9"/>  <line x1="9"  y1="23" x2="6"  y2="26"/>
  </g>
</svg>`)}`;

const EXTRAPOLATION_WINDOW_S = 12;

@Component({
  selector: 'app-satellite-map',
  imports: [DecimalPipe, DatePipe, FormsModule, PassesPanel, SatelliteSearch, PerformanceOverlay, SatelliteRadar],
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
  readonly selectedPass  = signal<PassSelection | null>(null);
  readonly radarTab      = signal<'radar' | 'details'>('radar');
  readonly showSearch    = signal(false);
  readonly viewMode      = signal<'3d' | '2d'>('3d');

  get viewerInstance(): Viewer {
    return this.viewer;
  }

  private viewer!: Viewer;
  private sampledPos!: SampledPositionProperty;
  private groundSampledPos!: SampledPositionProperty;
  private firstSample = true;
  private pollCount = 0;
  private nightCanvas!: HTMLCanvasElement;
  private nightOverlayLayer: ImageryLayer | null = null;
  private lastNightJulianDate?: JulianDate;
  private footprintRadiusM = 0;

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
        this.initNightOverlay();
        this.addSunEntity();
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
    this.viewer.scene.globe.enableLighting          = true;
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
      viewFrom: new Cartesian3(-3000000, -3000000, 1500000), // Zoom out default camera offset (meters: -3000km EN, 1500km U)
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
        trailTime:  5400,
        leadTime:   5400,
        width:      1.5,
        material:   Color.fromCssColorString('#ef4444'),
      },
    });
  }

  private addGroundProjectionEntities(): void {
    this.viewer.entities.add({
      id: 'ground-projection',
      position: this.groundSampledPos,
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString('#808080'),
        outlineColor: Color.fromCssColorString('#404040'),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.5e6, 1.2, 1.5e8, 0.4),
      },
    });

    this.viewer.entities.add({
      id: 'footprint',
      position: this.groundSampledPos,
      ellipse: {
        semiMajorAxis: new CallbackProperty(() => this.footprintRadiusM * 0.25, false),
        semiMinorAxis: new CallbackProperty(() => this.footprintRadiusM * 0.25, false),
        material: Color.fromCssColorString('#80808018'),
        outline: true,
        outlineColor: Color.fromCssColorString('#80808060'),
        outlineWidth: 1,
        heightReference: HeightReference.CLAMP_TO_GROUND,
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
          color: Color.fromCssColorString('#80808060'),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entity.position = this.sampledPos as any; // Cesium: Entity.position setter is typed as SampledPositionProperty but accepts PositionProperty subclasses
      if (entity.label?.text instanceof ConstantProperty) {
        entity.label.text.setValue('');
      }
    }
    const groundEntity = this.viewer.entities.getById('ground-projection');
    if (groundEntity) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      groundEntity.position = this.groundSampledPos as any; // Cesium: same setter type gap
    }
    const footprintEntity = this.viewer.entities.getById('footprint');
    if (footprintEntity) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      footprintEntity.position = this.groundSampledPos as any; // Cesium: same setter type gap
    }
    this.footprintRadiusM = 0;

    // Limpiar entidades de simulación dinámica de Starlink/Gateway
    this.viewer.entities.removeById('starlink-neighbor-ahead');
    this.viewer.entities.removeById('starlink-neighbor-behind');
    this.viewer.entities.removeById('starlink-laser-ahead');
    this.viewer.entities.removeById('starlink-laser-behind');
    this.viewer.entities.removeById('sim-observer');
    this.viewer.entities.removeById('sim-observer-cone');
    this.viewer.entities.removeById('sim-observer-link');
    this.viewer.entities.removeById('sim-gateway');
    this.viewer.entities.removeById('sim-gateway-link');
  }

  private addSample(data: SatelliteState): void {
    if (!this.viewer || !this.sampledPos) return;

    // Reciclar la trayectoria cada 100 ticks (~5 minutos de polling) para evitar fugas de memoria y centrar el trazo
    this.pollCount++;
    if (this.pollCount >= 100) {
      this.pollCount = 0;
      this.resetTrajectory();
      this.preloadOrbit(data.tle.line1, data.tle.line2, new Date(data.propagation.timestamp));
    }

    const time = JulianDate.fromDate(new Date(data.propagation.timestamp));
    const { x, y, z } = data.state.ecef.position_km;
    const position = new Cartesian3(x * 1000, y * 1000, z * 1000);

    this.sampledPos.addSample(time, position);

    const { lat_deg, lon_deg, alt_km } = data.state.geodetic;
    this.groundSampledPos.addSample(time, Cartesian3.fromDegrees(lon_deg, lat_deg, 0));

    const R = 6371;
    this.footprintRadiusM = R * 1000 * Math.acos(Math.min(1, R / (R + alt_km)));

    this.viewer.clock.currentTime = JulianDate.now();

    const entity = this.viewer.entities.getById('satellite');
    if (entity?.label?.text instanceof ConstantProperty) {
      entity.label.text.setValue(data.satellite.name);
    }

    if (this.firstSample) {
      this.firstSample = false;
      this.preloadOrbit(data.tle.line1, data.tle.line2, new Date(data.propagation.timestamp));
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

    this.updateStarlinkSimulation(data);
  }

  private getNeighborPosition(data: SatelliteState, timeOffsetS: number): Cartesian3 | null {
    try {
      const date = new Date(new Date(data.propagation.timestamp).getTime() + timeOffsetS * 1000);
      const satrec = twoline2satrec(data.tle.line1, data.tle.line2);
      const pv = propagate(satrec, date);
      if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
      const gst = gstime(date);
      const ecf = eciToEcf(pv.position, gst);
      return new Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
    } catch {
      return null;
    }
  }

  private updateStarlinkSimulation(data: SatelliteState): void {
    if (!this.viewer) return;

    const isStarlink = data.satellite.name.toUpperCase().includes('STARLINK');

    // ─── 1. SIMULACIÓN DE ENLACES LÁSER (VECINOS VIRTUALES) ───
    const aheadId = 'starlink-neighbor-ahead';
    const behindId = 'starlink-neighbor-behind';
    const laserAheadId = 'starlink-laser-ahead';
    const laserBehindId = 'starlink-laser-behind';

    if (isStarlink) {
      const posAhead = this.getNeighborPosition(data, 120); // 2 minutos adelante
      const posBehind = this.getNeighborPosition(data, -120); // 2 minutos atrás

      // Neighbor Ahead
      if (posAhead) {
        const nAhead = this.viewer.entities.getById(aheadId);
        if (!nAhead) {
          this.viewer.entities.add({
            id: aheadId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            position: posAhead as any, // Cesium: Entity options position is typed as PositionProperty; Cartesian3 is valid at runtime
            point: {
              pixelSize: 6,
              color: Color.fromCssColorString('#00ffff'),
              outlineColor: Color.BLACK,
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: `${data.satellite.name} (Link A)`,
              font: '10px sans-serif',
              fillColor: Color.fromCssColorString('#00ffff'),
              pixelOffset: new Cartesian2(0, 15),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          });
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nAhead.position = posAhead as any; // Cesium: same Entity.position setter gap
        }

        // Laser line Ahead
        const laserAhead = this.viewer.entities.getById(laserAheadId);
        if (!laserAhead) {
          this.viewer.entities.add({
            id: laserAheadId,
            polyline: {
              positions: new CallbackProperty(() => {
                const sPos = this.sampledPos.getValue(JulianDate.now());
                const naPos = nAhead?.position?.getValue(JulianDate.now());
                if (!sPos || !naPos) return [];
                return [sPos, naPos];
              }, false),
              width: 2.0,
              material: new PolylineDashMaterialProperty({
                color: Color.fromCssColorString('#00ffffcc'),
                dashLength: 8,
              }),
            }
          });
        }
      }

      // Neighbor Behind
      if (posBehind) {
        const nBehind = this.viewer.entities.getById(behindId);
        if (!nBehind) {
          this.viewer.entities.add({
            id: behindId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            position: posBehind as any, // Cesium: same Entity options position gap
            point: {
              pixelSize: 6,
              color: Color.fromCssColorString('#00ffff'),
              outlineColor: Color.BLACK,
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: `${data.satellite.name} (Link B)`,
              font: '10px sans-serif',
              fillColor: Color.fromCssColorString('#00ffff'),
              pixelOffset: new Cartesian2(0, 15),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          });
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nBehind.position = posBehind as any; // Cesium: same Entity.position setter gap
        }

        // Laser line Behind
        const laserBehind = this.viewer.entities.getById(laserBehindId);
        if (!laserBehind) {
          this.viewer.entities.add({
            id: laserBehindId,
            polyline: {
              positions: new CallbackProperty(() => {
                const sPos = this.sampledPos.getValue(JulianDate.now());
                const nbPos = nBehind?.position?.getValue(JulianDate.now());
                if (!sPos || !nbPos) return [];
                return [sPos, nbPos];
              }, false),
              width: 2.0,
              material: new PolylineDashMaterialProperty({
                color: Color.fromCssColorString('#00ffffcc'),
                dashLength: 8,
              }),
            }
          });
        }
      }
    } else {
      this.viewer.entities.removeById(aheadId);
      this.viewer.entities.removeById(behindId);
      this.viewer.entities.removeById(laserAheadId);
      this.viewer.entities.removeById(laserBehindId);
    }

    // ─── 2. SIMULACIÓN DE CONEXIÓN CON OBSERVADOR Y GATEWAY (SI HAY PASE SELECCIONADO) ───
    const obsSel = this.selectedPass();
    const obsId = 'sim-observer';
    const obsConeId = 'sim-observer-cone';
    const obsLinkId = 'sim-observer-link';
    const gatewayId = 'sim-gateway';
    const gatewayLinkId = 'sim-gateway-link';

    if (obsSel) {
      const lat = obsSel.observerLat;
      const lon = obsSel.observerLon;
      const alt = data.state.geodetic.alt_km;
      const observerPos = Cartesian3.fromDegrees(lon, lat, 0);

      // 1. Dibujar Observador (Antena)
      if (!this.viewer.entities.getById(obsId)) {
        this.viewer.entities.add({
          id: obsId,
          position: observerPos,
          point: {
            pixelSize: 12,
            color: Color.fromCssColorString('#10b981'),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: 'Tu Antena Starlink',
            font: 'bold 12px sans-serif',
            fillColor: Color.fromCssColorString('#10b981'),
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -20),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        });
      }

      // 2. Dibujar Cono de Cobertura Translúcido
      const altM = alt * 1000;
      const conePosition = Cartesian3.fromDegrees(lon, lat, altM / 2);

      const coneEntity = this.viewer.entities.getById(obsConeId);
      if (!coneEntity) {
        this.viewer.entities.add({
          id: obsConeId,
          position: conePosition,
          cylinder: {
            length: altM,
            topRadius: altM * Math.tan(35 * Math.PI / 180),
            bottomRadius: 0,
            material: Color.fromCssColorString('#10b98115'),
            outline: true,
            outlineColor: Color.fromCssColorString('#10b98140'),
            outlineWidth: 1.0,
          }
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        coneEntity.position = conePosition as any; // Cesium: Entity.position setter gap
        if (coneEntity.cylinder) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          coneEntity.cylinder.length = altM as any; // Cesium: CylinderGraphics properties are typed as Property but accept plain numbers at runtime
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          coneEntity.cylinder.topRadius = (altM * Math.tan(35 * Math.PI / 180)) as any; // Cesium: same Property/number gap
        }
      }

      // 3. Conexión activa si el satélite está a una distancia viable (< 1800 km)
      const now = JulianDate.now();
      const satPos = this.sampledPos.getValue(now);
      let isViable = false;

      if (satPos) {
        const dist = Cartesian3.distance(satPos, observerPos) / 1000; // en km
        isViable = dist < 1800;
      }

      const obsLink = this.viewer.entities.getById(obsLinkId);
      if (isViable && satPos) {
        if (!obsLink) {
          this.viewer.entities.add({
            id: obsLinkId,
            polyline: {
              positions: new CallbackProperty(() => {
                const sPos = this.sampledPos.getValue(JulianDate.now());
                if (!sPos) return [];
                return [observerPos, sPos];
              }, false),
              width: 3.0,
              material: Color.fromCssColorString('#10b981'),
            }
          });
        }
      } else {
        if (obsLink) {
          this.viewer.entities.remove(obsLink);
        }
      }

      // 4. Estación Terrestre / Gateway Virtual a ~250km
      const gatewayPos = Cartesian3.fromDegrees(lon + 2.5, lat - 0.5, 0);
      if (!this.viewer.entities.getById(gatewayId)) {
        this.viewer.entities.add({
          id: gatewayId,
          position: gatewayPos,
          point: {
            pixelSize: 10,
            color: Color.fromCssColorString('#ef4444'),
            outlineColor: Color.WHITE,
            outlineWidth: 1.5,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: 'Estación Gateway SpaceX',
            font: '11px sans-serif',
            fillColor: Color.fromCssColorString('#ef4444'),
            outlineColor: Color.BLACK,
            outlineWidth: 1.5,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, 15),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        });
      }

      // 5. Downlink animado
      const gwLink = this.viewer.entities.getById(gatewayLinkId);
      if (isViable && satPos) {
        if (!gwLink) {
          this.viewer.entities.add({
            id: gatewayLinkId,
            polyline: {
              positions: new CallbackProperty(() => {
                const sPos = this.sampledPos.getValue(JulianDate.now());
                if (!sPos) return [];
                return [sPos, gatewayPos];
              }, false),
              width: 2.0,
              material: new PolylineDashMaterialProperty({
                color: Color.fromCssColorString('#ef4444cc'),
                dashLength: 12,
              })
            }
          });
        }
      } else {
        if (gwLink) {
          this.viewer.entities.remove(gwLink);
        }
      }
    } else {
      this.viewer.entities.removeById(obsId);
      this.viewer.entities.removeById(obsConeId);
      this.viewer.entities.removeById(obsLinkId);
      this.viewer.entities.removeById(gatewayId);
      this.viewer.entities.removeById(gatewayLinkId);
    }
  }

  private preloadOrbit(tle1: string, tle2: string, centerDate: Date): void {
    const satrec = twoline2satrec(tle1, tle2);
    const stepS  = 60;
    const halfS  = 5400;

    for (let dt = -halfS; dt <= halfS; dt += stepS) {
      const date = new Date(centerDate.getTime() + dt * 1000);
      const pv  = propagate(satrec, date);
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
      const pos = pv.position;

      const gst = gstime(date);
      const ecf = eciToEcf(pos, gst);
      const geo = eciToGeodetic(pos, gst);
      const time = JulianDate.fromDate(date);

      this.sampledPos.addSample(
        time,
        new Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000),
      );
      this.groundSampledPos.addSample(
        time,
        Cartesian3.fromDegrees(degreesLong(geo.longitude), degreesLat(geo.latitude), 0),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Day / Night overlay
  // ─────────────────────────────────────────────────────────────────────────

  private initNightOverlay(): void {
    this.lastNightJulianDate = this.viewer.clock.currentTime.clone();
    this.nightCanvas = document.createElement('canvas');
    this.nightCanvas.width  = 720;
    this.nightCanvas.height = 360;
    this.updateNightOverlay();
    this.viewer.scene.postRender.addEventListener(() => {
      if (!this.lastNightJulianDate) return;
      const simDiff = Math.abs(JulianDate.secondsDifference(this.viewer.clock.currentTime, this.lastNightJulianDate));
      if (simDiff > 60 || !this.nightOverlayLayer) {
        this.lastNightJulianDate = this.viewer.clock.currentTime.clone();
        this.updateNightOverlay();
      }
    });
  }

  private async updateNightOverlay(): Promise<void> {
    const simTime = this.viewer.clock.currentTime;
    const date = JulianDate.toDate(simTime);
    const { lat, lon } = this.getSunSubsolarPoint(date);
    this.renderNightCanvas(this.nightCanvas, lat, lon);
    
    const provider = await SingleTileImageryProvider.fromUrl(
      this.nightCanvas.toDataURL('image/png'),
      { rectangle: Rectangle.fromDegrees(-180, -90, 180, 90) },
    );
    if (this.nightOverlayLayer) {
      this.viewer.imageryLayers.remove(this.nightOverlayLayer, false);
    }
    const layer = new ImageryLayer(provider, { alpha: 1.0 });
    this.viewer.imageryLayers.add(layer);
    this.nightOverlayLayer = layer;
  }

  private renderNightCanvas(canvas: HTMLCanvasElement, lat: number, lon: number): void {
    const ctx  = canvas.getContext('2d')!;
    const W    = canvas.width;
    const H    = canvas.height;
    const subLatR   = lat * (Math.PI / 180);
    const subLonR   = lon * (Math.PI / 180);
    const cosSubLat = Math.cos(subLatR);
    const sinSubLat = Math.sin(subLatR);
    const imgData = ctx.createImageData(W, H);
    const d       = imgData.data;

    for (let y = 0; y < H; y++) {
      const latR   = Math.PI / 2 - (y / H) * Math.PI;
      const cosLat = Math.cos(latR);
      const sinLat = Math.sin(latR);
      for (let x = 0; x < W; x++) {
        const lonR = (x / W) * 2 * Math.PI - Math.PI;
        // cosZ > 0 = day, cosZ < 0 = night; ~6° twilight band where cosZ ∈ (-0.105, 0)
        const cosZ = sinSubLat * sinLat + cosSubLat * cosLat * Math.cos(lonR - subLonR);
        const i = (y * W + x) * 4;
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 10;
        if (cosZ >= 0) {
          d[i + 3] = 0;
        } else if (cosZ > -0.105) {
          const t = -cosZ / 0.105;
          d[i + 3] = Math.round(t * t * 195);
        } else {
          d[i + 3] = 195;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  private getSunSubsolarPoint(date: Date): { lat: number; lon: number } {
    const D = date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0;
    const g = (357.529 + 0.98560028 * D) * (Math.PI / 180);
    // Modulo in degrees BEFORE converting to avoid floating-point precision loss
    // (D ~ 9600 makes raw values ~3.4M°; multiplying by π/180 first loses ~50° of accuracy)
    const q       = ((280.459          + 0.98564736629 * D) % 360 + 360) % 360;
    const gmstDeg = ((280.46061837     + 360.98564736629 * D) % 360 + 360) % 360;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * (Math.PI / 180);
    const e = (23.439 - 3.56e-7 * D) * (Math.PI / 180);
    const lat  = Math.asin(Math.sin(e) * Math.sin(L)) * (180 / Math.PI);
    const raDeg = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * (180 / Math.PI);
    let lon = raDeg - gmstDeg;
    while (lon >  180) lon -= 360;
    while (lon < -180) lon += 360;
    return { lat, lon };
  }

  private addSunEntity(): void {
    // Cesium: CallbackProperty returning Cartesian3 is valid for position but typed as generic Property — cast required
    const sunPosition = new CallbackProperty((time: unknown, result: unknown) => {
      if (!time) return result ?? Cartesian3.ZERO;
      const date = JulianDate.toDate(time as ReturnType<typeof JulianDate.now>);
      const { lat, lon } = this.getSunSubsolarPoint(date);
      return Cartesian3.fromDegrees(lon, lat, 0, this.viewer.scene.globe.ellipsoid, result as Cartesian3);
    }, false) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    this.viewer.entities.add({
      id:   'sun-position',
      show: false,
      position: sunPosition,
      billboard: {
        image:  SUN_ICON,
        width:  26,
        height: 26,
        heightReference:          HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  toggleViewMode(): void {
    if (!this.viewer) return;
    const next = this.viewMode() === '3d' ? '2d' : '3d';
    this.viewMode.set(next);
    this.ngZone.runOutsideAngular(() => {
      const nadirLine = this.viewer.entities.getById('nadir-line');
      if (nadirLine) nadirLine.show = next === '3d';
      const sunEntity = this.viewer.entities.getById('sun-position');
      if (sunEntity) sunEntity.show = next === '2d';
      if (next === '2d') {
        this.viewer.scene.morphTo2D(1.0);
      } else {
        this.viewer.scene.morphTo3D(1.0);
      }
    });
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
  get isAscendingStarlink(): boolean {
    const data = this.posState().data;
    if (!data) return false;
    const name = data.satellite.name.toUpperCase();
    const alt = data.state.geodetic.alt_km;
    return name.includes('STARLINK') && alt < 450;
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

  openSearch(): void  { this.showSearch.set(true);  }
  closeSearch(): void { this.showSearch.set(false); }

  onSatelliteSelected(noradId: number): void {
    this.noradId.set(noradId);
    this.showSearch.set(false);
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

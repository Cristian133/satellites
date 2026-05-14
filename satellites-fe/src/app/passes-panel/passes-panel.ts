import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule }   from '@angular/forms';
import { DatePipe }      from '@angular/common';
import { SatelliteService }                       from '../satellite.service';
import type { SatellitePass, PassSelection }       from '../satellite.model';

const CARDINAL = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];

@Component({
  selector: 'app-passes-panel',
  imports: [FormsModule, DatePipe],
  templateUrl: './passes-panel.html',
  styleUrl:    './passes-panel.scss',
})
export class PassesPanel {
  readonly noradId      = input.required<number>();
  readonly passSelected = output<PassSelection | null>();

  private readonly service = inject(SatelliteService);

  readonly lat          = signal<number | null>(null);
  readonly lon          = signal<number | null>(null);
  readonly loading      = signal(false);
  readonly error        = signal<string | null>(null);
  readonly expanded     = signal(true);
  readonly hasSearched  = signal(false);
  readonly onlyVisible  = signal(false);
  readonly selectedPass = signal<SatellitePass | null>(null);

  private readonly rawPasses = signal<SatellitePass[]>([]);

  readonly groupedPasses = computed(() => {
    const list = this.onlyVisible()
      ? this.rawPasses().filter(p => p.visible)
      : this.rawPasses();
    const groups = new Map<string, SatellitePass[]>();
    for (const p of list) {
      const key = new Date(p.rise.time).toLocaleDateString('es-AR', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    return [...groups.entries()].map(([date, passes]) => ({ date, passes }));
  });

  readonly canSearch = computed(() => this.lat() !== null && this.lon() !== null && !this.loading());

  constructor() {
    // Clear results when satellite changes
    effect(() => {
      this.noradId();
      this.rawPasses.set([]);
      this.hasSearched.set(false);
      this.error.set(null);
      this.selectedPass.set(null);
      this.passSelected.emit(null);
    });
  }

  toggle(): void {
    this.expanded.set(!this.expanded());
  }

  toggleVisibleFilter(): void {
    this.onlyVisible.set(!this.onlyVisible());
    this.selectedPass.set(null);
    this.passSelected.emit(null);
  }

  selectPass(pass: SatellitePass): void {
    if (this.selectedPass() === pass) {
      this.selectedPass.set(null);
      this.passSelected.emit(null);
    } else {
      this.selectedPass.set(pass);
      this.passSelected.emit({
        pass,
        observerLat: this.lat()!,
        observerLon: this.lon()!,
      });
    }
  }

  azToCardinal(az: number): string {
    return CARDINAL[Math.round(az / 22.5) % 16]!;
  }

  formatDuration(s: number): string {
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  }

  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.error.set('Geolocalización no disponible en este navegador');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.lat.set(parseFloat(pos.coords.latitude.toFixed(4)));
        this.lon.set(parseFloat(pos.coords.longitude.toFixed(4)));
        this.error.set(null);
      },
      () => this.error.set('No se pudo obtener la ubicación'),
    );
  }

  search(): void {
    const lat = this.lat();
    const lon = this.lon();
    if (lat === null || lon === null) return;

    this.loading.set(true);
    this.error.set(null);

    this.service.getPasses(this.noradId(), lat, lon).subscribe({
      next: (r) => {
        this.rawPasses.set(r.passes);
        this.hasSearched.set(true);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? err?.message ?? 'Error desconocido');
        this.hasSearched.set(true);
        this.loading.set(false);
      },
    });
  }
}

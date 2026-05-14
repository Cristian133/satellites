import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, switchMap } from 'rxjs';
import { SatelliteService } from '../satellite.service';
import type { SatelliteSummary } from '../satellite.model';

const GROUP_META: Record<string, { label: string; icon: string }> = {
  'Space Stations':      { label: 'Estaciones Espaciales', icon: '🛰' },
  'Visually Observable': { label: 'Observables',           icon: '🔭' },
  'Weather':             { label: 'Meteorológicos',        icon: '🌦' },
  'Amateur Radio':       { label: 'Radio Amateur',         icon: '📡' },
  'Other':               { label: 'Otros',                 icon: '🛸' },
};

function groupMeta(name: string) {
  return GROUP_META[name] ?? { label: name, icon: '🛸' };
}

@Component({
  selector:    'app-satellite-search',
  imports:     [FormsModule],
  templateUrl: './satellite-search.html',
  styleUrl:    './satellite-search.scss',
})
export class SatelliteSearch implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;

  readonly currentNoradId   = input.required<number>();
  readonly satelliteSelected = output<number>();
  readonly closed            = output<void>();

  private readonly service = inject(SatelliteService);
  private readonly query$  = new Subject<string>();

  readonly query    = signal('');
  readonly results  = signal<SatelliteSummary[]>([]);
  readonly loading  = signal(false);
  readonly activeIdx = signal(-1);

  readonly grouped = computed(() => {
    const map = new Map<string, SatelliteSummary[]>();
    for (const s of this.results()) {
      const arr = map.get(s.groupName) ?? [];
      arr.push(s);
      map.set(s.groupName, arr);
    }
    const order = ['Space Stations','Visually Observable','Weather','Amateur Radio','Other'];
    return [...map.entries()]
      .sort(([a],[b]) => (order.indexOf(a) ?? 99) - (order.indexOf(b) ?? 99))
      .map(([groupName, sats]) => ({ ...groupMeta(groupName), sats }));
  });

  readonly flatResults = computed(() => this.grouped().flatMap(g => g.sats));

  private sub?: Subscription;

  constructor() {
    effect(() => {
      this.query();
      this.activeIdx.set(-1);
    });
  }

  ngOnInit(): void {
    this.sub = this.query$.pipe(
      debounceTime(200),
      switchMap(q => {
        this.loading.set(true);
        return this.service.searchSatellites(q);
      }),
    ).subscribe(sats => {
      this.results.set(sats);
      this.loading.set(false);
    });

    // Initial load — show all
    this.query$.next('');

    setTimeout(() => this.searchInputRef?.nativeElement.focus(), 50);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onQueryChange(q: string): void {
    this.query.set(q);
    this.query$.next(q);
  }

  onKeydown(event: KeyboardEvent): void {
    const flat = this.flatResults();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIdx.set(Math.min(this.activeIdx() + 1, flat.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIdx.set(Math.max(this.activeIdx() - 1, -1));
        break;
      case 'Enter': {
        const idx = this.activeIdx();
        if (idx >= 0 && flat[idx]) this.select(flat[idx]!.noradId);
        break;
      }
      case 'Escape':
        this.close();
        break;
    }
  }

  select(noradId: number): void {
    this.satelliteSelected.emit(noradId);
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  groupMeta(name: string) { return groupMeta(name); }

  formatPeriod(min: number): string {
    if (min >= 1380) return `${(min / 1440).toFixed(1)}d`;
    if (min >= 60)   return `${Math.floor(min / 60)}h ${min % 60}m`;
    return `${min}m`;
  }

  orbitType(periodMin: number, inclination: number): string {
    if (periodMin > 1200)          return 'GEO';
    if (periodMin > 700)           return 'MEO';
    if (Math.abs(inclination - 98) < 3) return 'SSO';
    return 'LEO';
  }
}

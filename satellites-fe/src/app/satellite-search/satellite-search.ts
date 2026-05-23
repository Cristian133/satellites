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
  'Starlink':            { label: 'Starlink',              icon: '✨' },
  'OneWeb':              { label: 'OneWeb',                icon: '🌐' },
  'GPS Operational':     { label: 'GPS Operacional',       icon: '🛰' },
  'GLONASS Operational': { label: 'GLONASS Operacional',   icon: '🛰' },
  'Galileo':             { label: 'Galileo',               icon: '🛰' },
  'BeiDou':              { label: 'BeiDou',                icon: '🛰' },
  'Science':             { label: 'Científicos',           icon: '🔬' },
  'Geodetic':            { label: 'Geodésicos',            icon: '📐' },
  'Other':               { label: 'Otros',                 icon: '🛸' },
};

const COUNTRY_INFO: Record<string, { name: string; flag: string }> = {
  'US':   { name: 'Estados Unidos', flag: '🇺🇸' },
  'USA':  { name: 'Estados Unidos', flag: '🇺🇸' },
  'CIS':  { name: 'Rusia (CEI)', flag: '🇷🇺' },
  'RUS':  { name: 'Rusia', flag: '🇷🇺' },
  'PRC':  { name: 'China', flag: '🇨🇳' },
  'CHN':  { name: 'China', flag: '🇨🇳' },
  'JPN':  { name: 'Japón', flag: '🇯🇵' },
  'IND':  { name: 'India', flag: '🇮🇳' },
  'ESA':  { name: 'Agencia Espacial Europea', flag: '🇪🇺' },
  'FR':   { name: 'Francia', flag: '🇫🇷' },
  'FRA':  { name: 'Francia', flag: '🇫🇷' },
  'GER':  { name: 'Alemania', flag: '🇩🇪' },
  'UK':   { name: 'Reino Unido', flag: '🇬🇧' },
  'CA':   { name: 'Canadá', flag: '🇨🇦' },
  'CAN':  { name: 'Canadá', flag: '🇨🇦' },
  'ARGN': { name: 'Argentina', flag: '🇦🇷' },
  'ARG':  { name: 'Argentina', flag: '🇦🇷' },
  'BRA':  { name: 'Brasil', flag: '🇧🇷' },
  'MEX':  { name: 'México', flag: '🇲🇽' },
  'SPN':  { name: 'España', flag: '🇪🇸' },
  'ESP':  { name: 'España', flag: '🇪🇸' },
  'IT':   { name: 'Italia', flag: '🇮🇹' },
  'ITA':  { name: 'Italia', flag: '🇮🇹' },
  'SKOR': { name: 'Corea del Sur', flag: '🇰🇷' },
  'KOR':  { name: 'Corea del Sur', flag: '🇰🇷' },
  'PRK':  { name: 'Corea del Norte', flag: '🇰🇵' },
  'AUS':  { name: 'Australia', flag: '🇦🇺' },
  'ISRA': { name: 'Israel', flag: '🇮🇱' },
  'ISR':  { name: 'Israel', flag: '🇮🇱' },
  'IRAN': { name: 'Irán', flag: '🇮🇷' },
  'IRN':  { name: 'Irán', flag: '🇮🇷' },
  'TURK': { name: 'Turquía', flag: '🇹🇷' },
  'TUR':  { name: 'Turquía', flag: '🇹🇷' },
  'UAE':  { name: 'Emiratos Árabes', flag: '🇦🇪' },
  'ISS':  { name: 'Estación Espacial Internacional', flag: '🛰' },
  'SES':  { name: 'Luxemburgo (SES)', flag: '🇱🇺' },
  'GLOB': { name: 'Globalstar', flag: '🌐' },
  'ORB':  { name: 'Orbcomm', flag: '🌐' },
  'IRID': { name: 'Iridium', flag: '🌐' },
  'ITSO': { name: 'Intelsat', flag: '🌐' },
  'AB':   { name: 'Arab Sat', flag: '🇸🇦' },
  'EUTE': { name: 'Eutelsat', flag: '🇪🇺' },
  'EUT':  { name: 'Eutelsat', flag: '🇪🇺' },
  'NATO': { name: 'OTAN', flag: '🛡' },
  'TBD':  { name: 'Por determinar', flag: '❓' },
  'CHBZ': { name: 'China/Brasil', flag: '🇧🇷' },
  'ROC':  { name: 'Taiwán (ROC)', flag: '🇹🇼' },
  'FIN':  { name: 'Finlandia', flag: '🇫🇮' },
  'SEAL': { name: 'Sea Launch', flag: '🚀' },
  'SAU':  { name: 'Arabia Saudita', flag: '🇸🇦' },
  'EGY':  { name: 'Egipto', flag: '🇪🇬' },
  'ZAF':  { name: 'Sudáfrica', flag: '🇿🇦' },
  'SWE':  { name: 'Suecia', flag: '🇸🇪' },
  'SUI':  { name: 'Suiza', flag: '🇨🇭' },
  'NLD':  { name: 'Países Bajos', flag: '🇳🇱' },
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
  readonly selectedCountry = signal<string>('');

  readonly availableCountries = computed(() => {
    const counts = new Map<string, number>();
    for (const s of this.results()) {
      const code = s.country || 'UNK';
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([code, count]) => ({
        code,
        count,
        name: this.getCountryName(code === 'UNK' ? undefined : code),
        flag: this.getCountryFlag(code === 'UNK' ? undefined : code),
      }))
      .sort((a, b) => b.count - a.count);
  });

  readonly filteredResults = computed(() => {
    const country = this.selectedCountry();
    const sats = this.results();
    if (!country) return sats;
    return sats.filter(s => (s.country || 'UNK') === country);
  });

  readonly grouped = computed(() => {
    const map = new Map<string, SatelliteSummary[]>();
    for (const s of this.filteredResults()) {
      const arr = map.get(s.groupName) ?? [];
      arr.push(s);
      map.set(s.groupName, arr);
    }
    const order = [
      'Space Stations',
      'Visually Observable',
      'Weather',
      'Amateur Radio',
      'Starlink',
      'OneWeb',
      'GPS Operational',
      'GLONASS Operational',
      'Galileo',
      'BeiDou',
      'Science',
      'Geodetic',
      'Other'
    ];
    return [...map.entries()]
      .sort(([a],[b]) => (order.indexOf(a) ?? 99) - (order.indexOf(b) ?? 99))
      .map(([groupName, sats]) => ({ ...groupMeta(groupName), sats }));
  });

  readonly flatResults = computed(() => this.grouped().flatMap(g => g.sats));

  private sub?: Subscription;

  constructor() {
    effect(() => {
      this.query();
      this.selectedCountry.set('');
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

  getCountryFlag(code?: string): string {
    if (!code) return '🌐';
    return COUNTRY_INFO[code]?.flag ?? '🌐';
  }

  getCountryName(code?: string): string {
    if (!code) return 'Desconocido';
    return COUNTRY_INFO[code]?.name ?? `Código: ${code}`;
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

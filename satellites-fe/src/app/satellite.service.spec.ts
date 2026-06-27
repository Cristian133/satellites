import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SatelliteService } from './satellite.service';
import type { SatelliteSummary, StarlinkCensusResult } from './satellite.model';

describe('SatelliteService', () => {
  let service: SatelliteService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SatelliteService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('searchSatellites', () => {
    it('calls GET /api/satellites with the query param', fakeAsync(() => {
      let result: SatelliteSummary[] | undefined;
      service.searchSatellites('ISS').subscribe((r) => (result = r));

      const req = http.expectOne('/api/satellites?q=ISS');
      expect(req.request.method).toBe('GET');

      const mockData: SatelliteSummary[] = [
        { noradId: 25544, name: 'ISS (ZARYA)', orbitType: 'LEO', country: 'US' },
      ];
      req.flush(mockData);

      expect(result).toEqual(mockData);
    }));

    it('passes an empty string when no query provided', fakeAsync(() => {
      service.searchSatellites('').subscribe();
      const req = http.expectOne('/api/satellites?q=');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    }));
  });

  describe('getPasses', () => {
    it('calls GET /api/passes with correct params', fakeAsync(() => {
      service.getPasses(25544, 40.7, -74.0, 0, 3).subscribe();
      const req = http.expectOne(
        '/api/passes?noradId=25544&lat=40.7&lon=-74&alt=0&days=3',
      );
      expect(req.request.method).toBe('GET');
      req.flush({ satellite: {}, observer: {}, passes: [] });
    }));
  });

  describe('getStarlinkCensus', () => {
    it('calls GET /api/starlink/census', fakeAsync(async () => {
      const census$ = service.getStarlinkCensus();
      const promise = firstValueFrom(census$);

      const req = http.expectOne('/api/starlink/census');
      expect(req.request.method).toBe('GET');
      const mockCensus = { total: 5000 } as unknown as StarlinkCensusResult;
      req.flush(mockCensus);

      const result = await promise;
      expect(result).toEqual(mockCensus);
    }));
  });

  describe('pollPosition', () => {
    it('emits loading state immediately before any HTTP call', fakeAsync(() => {
      const states: unknown[] = [];
      const sub = service.pollPosition(25544).subscribe((s) => states.push(s));

      expect(states).toHaveLength(1);
      expect((states[0] as { loading: boolean }).loading).toBe(true);

      http.expectOne('/api/satellite/25544').flush({ propagation: { timestamp: 't1' } });
      tick(3000);
      http.expectOne('/api/satellite/25544').flush({ propagation: { timestamp: 't2' } });

      sub.unsubscribe();
      http.verify();
    }));

    it('emits error state when HTTP call fails', fakeAsync(() => {
      const states: unknown[] = [];
      const sub = service.pollPosition(99999).subscribe((s) => states.push(s));

      http.expectOne('/api/satellite/99999').flush(
        { error: 'Not found' },
        { status: 404, statusText: 'Not Found' },
      );

      const errorState = states.find((s) => (s as { error: string | null }).error !== null) as
        | { error: string }
        | undefined;
      expect(errorState?.error).toBeTruthy();

      sub.unsubscribe();
    }));
  });
});

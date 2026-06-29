import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { SatelliteService } from './satellite.service';
import type { SatelliteSummary, StarlinkCensusResult } from '../models/satellite.model';

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

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  describe('searchSatellites', () => {
    it('calls GET /api/satellites with the query param', async () => {
      const resultPromise = firstValueFrom(service.searchSatellites('ISS'));

      const req = http.expectOne('/api/satellites?q=ISS');
      expect(req.request.method).toBe('GET');

      const mockData: SatelliteSummary[] = [
        { noradId: 25544, name: 'ISS (ZARYA)', groupName: 'Space Stations', inclination: 51.6, periodMin: 92.8, orbitClass: 'LEO' },
      ];
      req.flush(mockData);

      const result = await resultPromise;
      expect(result).toEqual(mockData);
    });

    it('passes an empty string when no query provided', async () => {
      const done = firstValueFrom(service.searchSatellites(''));
      const req = http.expectOne('/api/satellites?q=');
      expect(req.request.method).toBe('GET');
      req.flush([]);
      await done;
    });
  });

  describe('getPasses', () => {
    it('calls GET /api/passes with correct params', async () => {
      const done = firstValueFrom(service.getPasses(25544, 40.7, -74.0, 0, 3));
      const req = http.expectOne(
        '/api/passes?noradId=25544&lat=40.7&lon=-74&alt=0&days=3',
      );
      expect(req.request.method).toBe('GET');
      req.flush({ satellite: {}, observer: {}, passes: [] });
      await done;
    });
  });

  describe('getStarlinkCensus', () => {
    it('calls GET /api/starlink/census', async () => {
      const promise = firstValueFrom(service.getStarlinkCensus());

      const req = http.expectOne('/api/starlink/census');
      expect(req.request.method).toBe('GET');
      const mockCensus = { total: 5000 } as unknown as StarlinkCensusResult;
      req.flush(mockCensus);

      const result = await promise;
      expect(result).toEqual(mockCensus);
    });
  });

  describe('pollPosition', () => {
    it('emits loading state immediately before any HTTP call', async () => {
      vi.useFakeTimers();

      const states: unknown[] = [];
      const sub = service.pollPosition(25544).subscribe((s) => states.push(s));

      expect(states).toHaveLength(1);
      expect((states[0] as { loading: boolean }).loading).toBe(true);

      http.expectOne('/api/satellite/25544').flush({ propagation: { timestamp: 't1' } });
      await vi.advanceTimersByTimeAsync(3000);
      http.expectOne('/api/satellite/25544').flush({ propagation: { timestamp: 't2' } });

      sub.unsubscribe();
    });

    it('emits error state when HTTP call fails', async () => {
      vi.useFakeTimers();

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
    });
  });
});

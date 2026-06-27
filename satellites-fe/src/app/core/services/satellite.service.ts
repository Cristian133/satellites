import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  catchError,
  distinctUntilChanged,
  interval,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import { FindPassesResult, PositionState, SatelliteApiResponse, SatelliteSummary, StarlinkCensusResult } from '../models/satellite.model';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SatelliteService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /**
   * Emite 3 segundos; cada tick cancela la petición anterior (switchMap)
   * y lanza una nueva. Errores individuales no rompen el stream:
   * se capturan dentro del switchMap y se emiten como estado de error,
   * dejando que el intervalo continúe en el siguiente tick.
   *
   * Flujo RxJS:
   *   interval(3000)
   *     └─ startWith(0)        → primer tick inmediato
   *     └─ switchMap → GET     → cancela la request anterior si aún está en vuelo
   *          └─ catchError     → error puntual → emite PositionState de error
   *     └─ shareReplay(1)      → los suscriptores tardíos reciben el último valor
   */
  pollPosition(noradId: number): Observable<PositionState> {
    return interval(3000).pipe(
      startWith(0),
      switchMap(() =>
        this.http.get<SatelliteApiResponse>(`${this.base}/api/satellite/${noradId}`).pipe(
          map(
            (data): PositionState => ({ data, error: null, loading: false })
          ),
          catchError((err) => {
            const message =
              err?.error?.error ?? err?.message ?? 'Error desconocido';
            return of<PositionState>({
              data: null,
              error: message,
              loading: false,
            });
          })
        )
      ),
      startWith<PositionState>({ data: null, error: null, loading: true }),
      // distinctUntilChanged evita re-renders cuando el satélite no se ha movido
      distinctUntilChanged(
        (a, b) =>
          a.loading === b.loading &&
          a.error === b.error &&
          a.data?.propagation.timestamp === b.data?.propagation.timestamp
      ),
      shareReplay(1)
    );
  }

  searchSatellites(q: string): Observable<SatelliteSummary[]> {
    return this.http.get<SatelliteSummary[]>(`${this.base}/api/satellites`, { params: { q } });
  }

  getPasses(
    noradId: number,
    lat: number,
    lon: number,
    alt = 0,
    days = 3,
  ): Observable<FindPassesResult> {
    return this.http.get<FindPassesResult>(`${this.base}/api/passes`, {
      params: { noradId, lat, lon, alt, days },
    });
  }

  getStarlinkCensus(): Observable<StarlinkCensusResult> {
    return this.http.get<StarlinkCensusResult>(`${this.base}/api/starlink/census`);
  }
}

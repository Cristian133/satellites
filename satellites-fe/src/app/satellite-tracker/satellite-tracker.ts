import { Component, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';
import { DecimalPipe, DatePipe } from '@angular/common';
import { SatelliteService } from '../satellite.service';
import { PositionState } from '../satellite.model';

@Component({
  selector: 'app-satellite-tracker',
  imports: [FormsModule, DecimalPipe, DatePipe],
  templateUrl: './satellite-tracker.html',
  styleUrl: './satellite-tracker.scss',
})
export class SatelliteTracker {
  private readonly service = inject(SatelliteService);

  /**
   * NORAD ID editable. Cambiar el valor cancela el polling anterior
   * y arranca uno nuevo automáticamente (gracias al switchMap).
   */
  readonly noradId = signal(25544);

  /**
   * Pipeline completo:
   *   noradId (Signal)
   *     → toObservable()       → Observable<number>
   *     → switchMap()          → cancela el poll anterior, inicia uno nuevo
   *     → service.pollPosition → interval(3s) + HTTP + error handling
   *     → toSignal()           → Signal<PositionState> (sin boilerplate de subscribe)
   */
  readonly state = toSignal(
    toObservable(this.noradId).pipe(
      switchMap((id) => this.service.pollPosition(id))
    ),
    { initialValue: { data: null, error: null, loading: true } as PositionState }
  );

  get geodetic() {
    return this.state().data?.state.geodetic ?? null;
  }

  get satelliteName() {
    return this.state().data?.satellite.name ?? null;
  }

  get lastUpdate() {
    const ts = this.state().data?.propagation.timestamp;
    return ts ? new Date(ts) : null;
  }

  onNoradChange(raw: string): void {
    const id = parseInt(raw, 10);
    if (!isNaN(id) && id > 0) this.noradId.set(id);
  }
}

import { Component, signal } from '@angular/core';
import { SatelliteMap } from './satellite-map/satellite-map';
import { KesslerGame } from './kessler-game/kessler-game';

@Component({
  selector: 'app-root',
  imports: [SatelliteMap, KesslerGame],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly currentMode = signal<'tracker' | 'kessler'>('tracker');
}

import { Component } from '@angular/core';
import { SatelliteMap } from './satellite-map/satellite-map';

@Component({
  selector: 'app-root',
  imports: [SatelliteMap],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}

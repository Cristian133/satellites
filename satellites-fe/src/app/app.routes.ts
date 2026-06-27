import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'tracker',
    loadComponent: () =>
      import('./features/tracker/satellite-map/satellite-map').then(
        (m) => m.SatelliteMap,
      ),
  },
  {
    path: 'kessler',
    loadComponent: () =>
      import('./features/kessler/kessler-game/kessler-game').then(
        (m) => m.KesslerGame,
      ),
  },
  {
    path: 'census',
    loadComponent: () =>
      import('./features/census/starlink-census/starlink-census').then(
        (m) => m.StarlinkCensus,
      ),
  },
  { path: '', redirectTo: 'tracker', pathMatch: 'full' },
];

# Satellites

Real-time satellite tracker with a 3D globe. Enter any NORAD ID to watch a satellite move across the Earth, see its ground track, and predict upcoming visible passes from your location.

## How it works

The backend fetches Two-Line Element (TLE) orbital data from [Celestrak](https://celestrak.org) and stores it in a local SQLite database, refreshing every 6 hours. On each API request it runs SGP4 propagation (via WebAssembly) to compute the satellite's current position. The frontend polls the API every 3 seconds and renders the trajectory on a CesiumJS globe.

## Architecture

```
satellites/
├── satellites-be/   Express + TypeScript API (Node.js)
└── satellites-fe/   Angular 21 app (CesiumJS globe)
```

### Backend stack

| Concern | Library |
|---|---|
| HTTP server | Express 5 |
| SGP4 propagation | `@wasmer/sgp4` (WebAssembly) |
| Database | SQLite via `better-sqlite3` |
| TLE source | Celestrak GP API |
| Scheduler | `node-cron` |

### Frontend stack

| Concern | Library |
|---|---|
| Framework | Angular 21 (standalone components) |
| 3D globe | CesiumJS |
| Reactive state | RxJS + Angular Signals |
| Styles | SCSS |

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm** 9+

## Quick start

### Backend

```bash
cd satellites-be
npm install
npm run dev        # tsx watch — restarts on file changes
```

The API listens on `http://localhost:3000`.  
On first start it syncs the TLE catalog from Celestrak (takes a few seconds). Set `SYNC_ON_START=false` to skip it.

### Frontend

```bash
cd satellites-fe
npm install
npm start          # ng serve — proxies /api/* to localhost:3000
```

Open `http://localhost:4200`. The dev proxy is configured in `proxy.conf.json`.

## API reference

### `GET /api/satellite/:noradId`

Propagates the satellite to the current instant and returns its position.

```jsonc
// GET /api/satellite/25544
{
  "satellite": { "noradId": 25544, "name": "ISS (ZARYA)" },
  "tle": { "line1": "...", "line2": "...", "epochMs": 1747123456789 },
  "propagation": { "t_minutes": 1234.56, "timestamp": "2026-05-14T12:00:00.000Z" },
  "state": {
    "teme":    { "position_km": { "x": ..., "y": ..., "z": ... }, "velocity_km_s": { ... } },
    "ecef":    { "position_km": { "x": ..., "y": ..., "z": ... } },
    "geodetic": { "lat_deg": 48.85, "lon_deg": 2.35, "alt_km": 408.3 }
  }
}
```

### `GET /api/passes`

Predicts upcoming passes visible from an observer's location.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `noradId` | integer | required | NORAD catalog number |
| `lat` | float | required | Observer latitude (−90…90) |
| `lon` | float | required | Observer longitude (−180…180) |
| `alt` | float | `0` | Observer altitude (km) |
| `days` | integer | `3` | Prediction window (max 10) |
| `minEl` | float | `10` | Minimum elevation (°) |

Each pass in the response includes rise / peak / set time with azimuth/elevation, whether the satellite will be **visually observable** (dark sky + illuminated satellite), and pass duration.

### `GET /api/status`

Returns catalog size and last sync metadata.

## Configuration

Environment variables for the backend (can be set in a `.env` file):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/satellites.db` | SQLite database path |
| `SYNC_ON_START` | `true` | Sync TLE catalog at startup |
| `SYNC_SCHEDULE` | `0 */6 * * *` | Cron expression for periodic sync |

## TLE catalog sources

The backend syncs the following Celestrak groups on startup and every 6 hours:

- Space Stations (ISS, Tiangong…)
- Visually Observable objects
- Weather satellites
- Amateur radio satellites

## Production build

```bash
# Backend
cd satellites-be && npm run build   # outputs to dist/
node dist/index.js

# Frontend
cd satellites-fe && npm run build   # outputs to dist/satellites-frontend/
```

## License

[MIT](LICENSE)

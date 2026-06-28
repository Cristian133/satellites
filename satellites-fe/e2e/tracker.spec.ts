import { test, expect, type Page, type Route } from '@playwright/test';

// ─── API fixtures ─────────────────────────────────────────────────────────────

const ISS_NORAD = 25544;

const mockSatellites = [
  {
    noradId: ISS_NORAD,
    name: 'ISS (ZARYA)',
    groupName: 'stations',
    inclination: 51.64,
    periodMin: 92.68,
    country: 'ISS',
  },
];

const mockPosition = {
  satellite: { noradId: ISS_NORAD, name: 'ISS (ZARYA)' },
  tle: {
    line1: '1 25544U 98067A   24001.00000000  .00001234  00000-0  12345-4 0  9990',
    line2: '2 25544  51.6400 100.0000 0001234  50.0000 310.0000 15.49650000123456',
    epochMs: Date.now() - 3600_000,
  },
  propagation: { t_minutes: 60, timestamp: new Date().toISOString() },
  state: {
    teme:     { position_km: { x: 4500, y: 3200, z: 3800 }, velocity_km_s: { x: -3.5, y: 5.1, z: 2.2 } },
    ecef:     { position_km: { x: 4200, y: 3100, z: 3900 } },
    geodetic: { lat_deg: 41.5, lon_deg: -74.2, alt_km: 408 },
  },
};

const mockPasses = {
  satellite: { noradId: ISS_NORAD, name: 'ISS (ZARYA)', tleAge_h: 1 },
  observer:  { lat_deg: 40.7128, lon_deg: -74.006, alt_km: 0 },
  passes: [
    {
      rise:             { time: new Date(Date.now() + 3_600_000).toISOString(), az_deg: 310, el_deg: 0 },
      peak:             { time: new Date(Date.now() + 3_720_000).toISOString(), az_deg: 10,  el_deg: 72 },
      set:              { time: new Date(Date.now() + 3_840_000).toISOString(), az_deg: 110, el_deg: 0 },
      visible:          true,
      maxElevation_deg: 72,
      duration_s:       240,
      magnitude:        -3.5,
      track:            [],
      celestialBodies:  [],
    },
  ],
};

// ─── Mock helpers ─────────────────────────────────────────────────────────────

async function mockApis(page: Page): Promise<void> {
  await page.route('**/api/satellites**', (route: Route) =>
    route.fulfill({ json: mockSatellites }),
  );
  await page.route(`**/api/satellite/${ISS_NORAD}`, (route: Route) =>
    route.fulfill({ json: mockPosition }),
  );
  await page.route('**/api/passes**', (route: Route) =>
    route.fulfill({ json: mockPasses }),
  );
  await page.route('**/api/status', (route: Route) =>
    route.fulfill({ json: { status: 'healthy', tleCount: 9000, lastSync: new Date().toISOString() } }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Tracker', () => {
  test('redirects root to /tracker', async ({ page }) => {
    await mockApis(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/tracker/);
  });

  test('shows the HUD with satellite name after search', async ({ page }) => {
    await mockApis(page);
    await page.goto('/tracker');

    // Open search palette
    await page.click('.hud__search-btn');
    await expect(page.locator('.palette__input')).toBeVisible();

    // Type ISS
    await page.fill('.palette__input', 'ISS');

    // Wait for and click the first result
    const firstResult = page.locator('.sat-row').first();
    await expect(firstResult).toBeVisible({ timeout: 5_000 });
    await firstResult.click();

    // HUD should now display the satellite name
    await expect(page.locator('.hud__name')).toContainText('ISS', { timeout: 5_000 });
  });

  test('shows altitude data in HUD cards', async ({ page }) => {
    await mockApis(page);
    await page.goto('/tracker');

    // Select ISS directly via NORAD ID input
    const noradInput = page.locator('#norad-hud');
    await noradInput.fill(String(ISS_NORAD));
    await noradInput.press('Enter');

    // HUD cards should show the mocked altitude
    await expect(page.locator('.hud__card').filter({ hasText: 'Altitud' }))
      .toContainText('408', { timeout: 5_000 });
  });

  test('passes panel shows predicted passes', async ({ page }) => {
    await mockApis(page);
    await page.goto('/tracker');

    // Select ISS
    const noradInput = page.locator('#norad-hud');
    await noradInput.fill(String(ISS_NORAD));
    await noradInput.press('Enter');

    // Passes panel should appear with at least one pass
    await expect(page.locator('app-passes-panel')).toBeVisible({ timeout: 5_000 });
  });
});

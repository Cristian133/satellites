"use strict";

import { openDatabase }  from "./db.js";
import { createApp }     from "./app.js";
import { syncAll, startCronJob } from "./services/tle-sync.service.js";
import { logger }        from "./logger.js";
import { env }           from "./config/env.js";
import { initSentry }    from "./telemetry/sentry.js";
import { updateTleAgeGauge } from "./repositories/tle.repository.js";

// Sentry must be initialized before any other imports that might throw
initSentry();

async function main(): Promise<void> {
  const db  = openDatabase();
  const app = createApp(db);

  // Seed TLE age gauge with current catalog state
  updateTleAgeGauge(db);

  if (env.SYNC_ON_START) {
    syncAll(db).catch((err: unknown) => {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[startup] Sync error");
    });
  }

  startCronJob(db);

  const port = parseInt(env.PORT, 10);
  app.listen(port, () => {
    logger.info(`Satellites API listening on http://localhost:${port}`);
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});

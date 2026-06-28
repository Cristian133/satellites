"use strict";

import * as Sentry from "@sentry/node";
import { env }     from "../config/env.js";

export function initSentry(): void {
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn:         env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Capture 100 % of transactions in non-production; reduce in prod if volume is high
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

export { Sentry };

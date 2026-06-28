"use strict";

export const env = {
  PORT:           process.env["PORT"]          ?? "3000",
  DB_PATH:        process.env["DB_PATH"],
  SYNC_ON_START:  process.env["SYNC_ON_START"] !== "false",
  SYNC_SCHEDULE:  process.env["SYNC_SCHEDULE"] ?? "0 */6 * * *",
  LOG_LEVEL:      process.env["LOG_LEVEL"]     ?? "info",
  NODE_ENV:       process.env["NODE_ENV"]      ?? "development",
  /** Optional. When set, all write endpoints require `x-api-key: <value>` header. */
  API_KEY:        process.env["API_KEY"],
  /** Optional. When set, errors are reported to Sentry. */
  SENTRY_DSN:     process.env["SENTRY_DSN"],
} as const;

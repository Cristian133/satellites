"use strict";

import { Worker }        from "worker_threads";
import path              from "path";
import type { PassesWorkerData, FindPassesResult } from "../workers/passes.worker.js";

// Detect dev (tsx) vs prod (compiled JS) to resolve worker path correctly
const WORKER_EXT  = path.extname(__filename);
const WORKER_PATH = path.resolve(
  path.dirname(__filename),
  "../workers/passes.worker" + WORKER_EXT,
);

export function findPassesInWorker(data: PassesWorkerData): Promise<FindPassesResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: data,
      execArgv:   process.execArgv,
    });

    worker.once("message", (msg: { ok: true; result: FindPassesResult } | { ok: false; error: string }) => {
      if (msg.ok) resolve(msg.result);
      else        reject(new Error(msg.error));
    });

    worker.once("error", reject);

    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Passes worker exited with code ${code}`));
    });
  });
}

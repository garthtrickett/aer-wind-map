import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute } from "node:path";
import { openWaveStore, monthKeys, defaultArchiveLimits } from "./store.ts";
import { advanceJob } from "./ecmwf.ts";
import { createArchiveWorker } from "./worker.ts";

export function createWaveHistoryRuntime(env: NodeJS.ProcessEnv = process.env, accountFor: (request: IncomingMessage) => string | null = () => null) {
  const path = env.AER_WAVE_HISTORY_DB ?? (env.RAILWAY_VOLUME_MOUNT_PATH ? `${env.RAILWAY_VOLUME_MOUNT_PATH}/aer-wave-history.sqlite` : "");
  if (path && !isAbsolute(path)) throw new Error("AER_WAVE_HISTORY_DB must be an absolute durable path");
  const store = path ? openWaveStore(path, {
    dailyMonths: Number(env.AER_ARCHIVE_DAILY_MONTH_LIMIT ?? defaultArchiveLimits.dailyMonths),
    pendingMonths: Number(env.AER_ARCHIVE_PENDING_MONTH_LIMIT ?? defaultArchiveLimits.pendingMonths),
  }) : null;
  const credentials = env.ECMWF_API_EMAIL && env.ECMWF_API_KEY ? { email: env.ECMWF_API_EMAIL, key: env.ECMWF_API_KEY } : null;
  const configured = !!store && !!credentials;
  const workerId = randomUUID();
  const worker = store && credentials ? createArchiveWorker(store, workerId, Number(env.AER_ARCHIVE_CONCURRENCY ?? 3),
    (job, signal) => advanceJob(store, job, credentials, signal)) : null;
  const reply = (response: ServerResponse, code: number, value: unknown) => {
    response.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value));
  };
  return {
    async handle(request: IncomingMessage, response: ServerResponse) {
      try {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (!["GET", "POST"].includes(request.method ?? "")) { reply(response, 405, { error: "Method not allowed" }); return; }
        const raw = ["latitude", "longitude", "startYear", "endYear"].map((key) => url.searchParams.get(key));
        const [latitude, longitude, start, end] = raw.map(Number);
        if (raw.some((v) => v === null || v.trim() === "") || ![latitude, longitude, start, end].every(Number.isFinite) ||
          Math.abs(latitude) > 89.75 || Math.abs(longitude) > 179.75 || !Number.isInteger(start) || !Number.isInteger(end) ||
          start < 2022 || end > 2025 || start > end || end - start > 4) {
          reply(response, 400, { error: "Choose an offshore point and complete years from 2022 to 2025 (up to five years)." }); return;
        }
        const keys = monthKeys(latitude, longitude, start, end);
        if (request.method === "POST") {
          if (!configured || !store) { reply(response, 503, { error: "The server archive connection is not configured yet." }); return; }
          // Browser requests must match the configured origin; no cross-site queue creation.
          const origin = request.headers.origin;
          if (!origin || origin !== env.PUBLIC_APP_URL?.replace(/\/$/, "")) { reply(response, 403, { error: "Open Aer on its configured domain to prepare history." }); return; }
          const owner = accountFor(request);
          if (!owner || owner === "expired-session") { reply(response, 401, { error: "Sign in to prepare new ECMWF history. Previously cached history is available without signing in." }); return; }
          store.enqueue(keys, owner); worker?.tick();
        }
        const progress = store?.progress(keys, configured) ?? { configured, total: keys.length, ready: 0, pending: 0, failed: 0, missing: keys.length, active: null, error: null };
        reply(response, 200, { progress, ...(url.searchParams.get("data") === "1" ? { months: store?.months(keys) ?? [] } : {}) });
      } catch (error) {
        // Only deliberate queue-limit errors are exposed. Provider/database internals stay on the server.
        const message = error instanceof Error ? error.message : "";
        reply(response, message.includes("limit reached") || message.includes("queue is full") ? 429 : 500,
          { error: message.includes("limit reached") || message.includes("queue is full") ? message : "The archive request could not be completed. Try again shortly." });
      }
    },
    async stop() { await worker?.stop(); store?.close(); },
  };
}

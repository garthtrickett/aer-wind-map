import type { WeatherError } from "./ecmwf.ts";
import type { ForecastRun, WindField } from "./wind.ts";

type LoadResult =
  | { readonly ok: true; readonly value: WindField }
  | { readonly ok: false; readonly error: WeatherError };

type WorkerReply =
  | { readonly key: string; readonly ok: true; readonly field: WindField }
  | { readonly key: string; readonly ok: false; readonly error: WeatherError };

export type ForecastWorker = Readonly<{
  load: (run: ForecastRun, step: number, key: string) => Promise<LoadResult>;
  terminate: () => void;
}>;

export const createForecastWorker = (): ForecastWorker => {
  let worker: Worker | null = null;
  let stopped = false;
  const pending = new Map<string, (result: LoadResult) => void>();
  const failPending = (detail: string): void => {
    const error: WeatherError = { kind: "decode", detail };
    for (const resolve of pending.values()) resolve({ ok: false, error });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  const activeWorker = (): Worker => {
    if (worker) return worker;
    const next = new Worker("/decoder/worker.js");
    next.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const resolve = pending.get(reply.key);
      if (!resolve) return;
      pending.delete(reply.key);
      resolve(reply.ok ? { ok: true, value: reply.field } : { ok: false, error: reply.error });
    };
    next.onerror = (event) => failPending(event.message || "Forecast decoder worker failed");
    next.onmessageerror = () => failPending("Forecast decoder worker sent an unreadable response");
    worker = next;
    return next;
  };
  return {
    load: (run, step, key) => new Promise((resolve) => {
      if (stopped) { resolve({ ok: false, error: { kind: "decode", detail: "Forecast decoder stopped" } }); return; }
      pending.set(key, resolve);
      try { activeWorker().postMessage({ run, step, key }); }
      catch (cause) { failPending(String(cause)); }
    }),
    terminate: () => { stopped = true; failPending("Forecast decoder stopped"); },
  };
};

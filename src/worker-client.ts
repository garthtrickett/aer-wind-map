import type { WeatherError } from "./ecmwf.ts";
import type { ForecastRun } from "./wind.ts";
import type { ForecastField, Layer } from "./wave.ts";

type LoadResult =
  | { readonly ok: true; readonly value: ForecastField }
  | { readonly ok: false; readonly error: WeatherError };

type WorkerReply =
  | { readonly key: string; readonly ok: true; readonly field: ForecastField }
  | { readonly key: string; readonly ok: false; readonly error: WeatherError };

export type ForecastWorker = Readonly<{
  load: (run: ForecastRun, step: number, key: string, layer: Layer) => Promise<LoadResult>;
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
    const next = new Worker(new URL("./decoder.worker.ts", import.meta.url), { type: "classic" });
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
    load: (run, step, key, layer) => new Promise((resolve) => {
      if (stopped) { resolve({ ok: false, error: { kind: "decode", detail: "Forecast decoder stopped" } }); return; }
      pending.set(key, resolve);
      try { activeWorker().postMessage({ run, step, key, layer }); }
      catch (cause) { failPending(String(cause)); }
    }),
    terminate: () => { stopped = true; failPending("Forecast decoder stopped"); },
  };
};

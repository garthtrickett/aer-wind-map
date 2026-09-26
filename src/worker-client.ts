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
  const worker = new Worker("/decoder/worker.js");
  const pending = new Map<string, (result: LoadResult) => void>();
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const resolve = pending.get(reply.key);
    if (!resolve) return;
    pending.delete(reply.key);
    resolve(reply.ok ? { ok: true, value: reply.field } : { ok: false, error: reply.error });
  };
  worker.onerror = (event) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: { kind: "decode", detail: event.message } });
    pending.clear();
  };
  return {
    load: (run, step, key) => new Promise((resolve) => {
      pending.set(key, resolve);
      worker.postMessage({ run, step, key });
    }),
    terminate: () => worker.terminate(),
  };
};

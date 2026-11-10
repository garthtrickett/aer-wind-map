import { loadPrimarySwellField } from "./primary-swell-data.ts";
import type { ForecastRun } from "./wind.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<{ key: string; run: ForecastRun; step: number }>) => {
  const { key, run, step } = event.data;
  queue = queue.then(async () => {
    try {
      const field = await loadPrimarySwellField(run, step, AbortSignal.timeout(90_000));
      scope.postMessage({ key, ok: true, field }, [field.waveHeight.buffer, field.wavePeriod.buffer, field.waveDirection!.buffer]);
    } catch {
      scope.postMessage({ key, ok: false, error: { kind: "unavailable", detail: "MFWAM primary swell is unavailable at this forecast time." } });
    }
  });
};

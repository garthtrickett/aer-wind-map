import type { Job, WaveStore } from "./store.ts";

/** One coordinator lease across replicas; several durable provider requests within it. */
export function createArchiveWorker(store: WaveStore, owner: string, concurrency: number,
  advance: (job: Job, signal: AbortSignal) => Promise<void>) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
    throw new Error("AER_ARCHIVE_CONCURRENCY must be between 1 and 20");
  const abort = new AbortController();
  const running = new Map<string, Promise<void>>();
  const tick = () => {
    if (abort.signal.aborted || !store.claim(owner)) return;
    for (const job of store.runnable(concurrency, new Set(running.keys()))) {
      const task = advance(job, abort.signal).catch(() => {
        // Normal provider errors are persisted by advanceJob. Keep unexpected failures retryable.
        console.error("Archive worker step interrupted; retained job state will be checked again.");
      }).finally(() => { running.delete(job.key); });
      running.set(job.key, task);
    }
  };
  const timer = setInterval(tick, 30_000); timer.unref();
  tick();
  return {
    tick,
    async stop() {
      clearInterval(timer); abort.abort();
      await Promise.allSettled(running.values());
      store.release(owner);
    },
  };
}

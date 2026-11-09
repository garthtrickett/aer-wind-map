import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openWaveStore, monthKeys, type Job } from "./store.ts";
import { createArchiveWorker } from "./worker.ts";
import type { EcwamMonth } from "../../src/wave-history-types.ts";

const month: EcwamMonth = { version: 1, year: 2025, month: 1, experiment: "iocj", latitude: 20, longitude: 130, hours: [] };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "aer-archive-worker-"));
  const path = join(dir, "archive.sqlite"), store = openWaveStore(path);
  const first = monthKeys(20, 130, 2022, 2025), second = monthKeys(25, 140, 2022, 2025);
  store.enqueue(first, "user"); store.enqueue(second, "user");
  return { dir, path, store, first, second };
}

test("three requests run concurrently, fill freed slots and share capacity across locations", async () => {
  const { dir, store } = setup();
  const started: Job[] = [], finish = new Map<string, () => void>();
  let active = 0, peak = 0;
  const worker = createArchiveWorker(store, "one", 3, async (job, signal) => {
    started.push(job); active++; peak = Math.max(peak, active);
    store.update(job.key, "polling", `https://api.ecmwf.int/v1/datasets/research/requests/${started.length}`);
    await new Promise<void>(resolve => {
      finish.set(job.key, resolve); signal.addEventListener("abort", () => resolve(), { once: true });
    });
    if (!signal.aborted) store.complete(job.key, month);
    active--;
  });
  try {
    assert.equal(started.length, 3);
    assert.equal(new Set(started.map(job => job.latitude)).size, 2, "another location must not wait for all 49 months");
    worker.tick(); worker.tick();
    assert.equal(started.length, 3, "busy jobs cannot be advanced twice");
    const completed = started[0].key;
    finish.get(completed)!(); await settle();
    worker.tick();
    assert.equal(started.length, 4);
    assert.equal(new Set(started.map(job => job.key)).size, 4);
    assert.equal(peak, 3);
    assert.equal(store.get(completed)?.state, "ready");
  } finally { await worker.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("provider jobs retain their slots between polls, and lowering concurrency resumes existing receipts", () => {
  const { dir, store, first } = setup();
  try {
    for (let index = 0; index < 3; index++) store.update(first[index].key, "polling", `receipt-${index}`);
    const jobs = store.runnable(3, new Set());
    assert.equal(jobs.length, 3); assert.ok(jobs.every(job => job.state === "polling"));
    assert.equal(store.runnable(3, new Set(jobs.map(job => job.key))).length, 0);
    assert.equal(store.runnable(1, new Set())[0].state, "polling");
    store.complete(jobs[0].key, month);
    const next = store.runnable(3, new Set(jobs.slice(1).map(job => job.key)));
    assert.equal(next.length, 1); assert.equal(next[0].state, "queued");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("overlapping deployments keep one coordinator and restart resumes receipts without resubmission", async () => {
  const { dir, path, store } = setup(), second = openWaveStore(path);
  const seen: Job[] = [];
  const hold = async (job: Job, signal: AbortSignal) => {
    seen.push(job);
    if (!job.provider) store.update(job.key, "polling", `saved-receipt-${seen.length}`);
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  };
  const old = createArchiveWorker(store, "old", 3, hold);
  const overlap = createArchiveWorker(second, "new", 3, hold);
  let successor: ReturnType<typeof createArchiveWorker> | null = null;
  try {
    assert.equal(seen.length, 3);
    overlap.tick(); assert.equal(seen.length, 3);
    await overlap.stop(); await old.stop();
    successor = createArchiveWorker(second, "successor", 3, hold);
    assert.equal(seen.length, 6);
    assert.ok(seen.slice(3).every(job => job.provider?.startsWith("saved-receipt-")));
    assert.deepEqual(seen.slice(3).map(job => job.key).sort(), seen.slice(0, 3).map(job => job.key).sort());
  } finally {
    await successor?.stop(); await overlap.stop(); await old.stop(); second.close(); store.close(); rmSync(dir, { recursive: true, force: true });
  }
});

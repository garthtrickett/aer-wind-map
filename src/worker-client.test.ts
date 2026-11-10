import assert from "node:assert/strict";
import { test } from "node:test";
import { createForecastWorker } from "./worker-client.ts";

const run = { id: "2026110912", date: "20261109", hour: 12, startedAt: "2026-11-09T12:00:00Z" };
test("a new swell time cancels obsolete work while an independent wind request survives", async () => {
  const native = globalThis.Worker;
  class FakeWorker {
    static instances: FakeWorker[] = [];
    stopped = false;
    onmessage: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    url: URL;
    options: WorkerOptions;
    constructor(url: URL, options: WorkerOptions) {
      this.url = url;
      this.options = options;
      FakeWorker.instances.push(this);
    }
    postMessage(_value: unknown) {}
    terminate() { this.stopped = true; }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const loader = createForecastWorker();
  try {
    const wind = loader.load(run, 3, "wind", "wind");
    const obsolete = loader.load(run, 3, "swell-3", "waves");
    const current = loader.load(run, 6, "swell-6", "waves");
    assert.equal((await obsolete).ok, false);
    assert.equal(FakeWorker.instances[0].stopped, false);
    assert.equal(FakeWorker.instances[1].stopped, true);
    assert.equal(FakeWorker.instances[2].options.type, "module");
    FakeWorker.instances[2].onmessage!({ data: { key: "swell-6", ok: true, field: { kind: "waves", source: "mfwam-primary" } } });
    assert.equal((await current).ok, true);
    FakeWorker.instances[0].onmessage!({ data: { key: "wind", ok: true, field: { kind: "wind" } } });
    assert.equal((await wind).ok, true);
    loader.terminate();
    assert.equal((await loader.load(run, 9, "stopped", "waves")).ok, false);
  } finally { loader.terminate(); globalThis.Worker = native; }
});

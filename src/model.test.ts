import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldKey, initialState, nap, present } from "./model.ts";
import type { WindField } from "./wind.ts";

const run = { date: "20260925", hour: 18, id: "2026092518", startedAt: "2026-09-25T18:00:00Z" };
const field: WindField = { run, step: 3, width: 1, height: 1, firstLatitude: 0, firstLongitude: 0, increment: 1, u: new Float32Array([1]), v: new Float32Array([0]), gust: null };

test("SAM loading accepts only the requested forecast", () => {
  const readyToLoad = present(initialState, { kind: "runFound", run });
  assert.deepEqual(nap(readyToLoad), { kind: "load", run, step: 3, key: fieldKey(run, 3) });
  const loading = present(readyToLoad, { kind: "loadStarted", key: fieldKey(run, 3) });
  assert.equal(present(loading, { kind: "fieldLoaded", key: "old:3", field }), loading);
  assert.equal(present(loading, { kind: "fieldLoaded", key: fieldKey(run, 3), field }).phase, "ready");
});

test("time changes discard an in-flight response", () => {
  const loading = present(present(initialState, { kind: "runFound", run }), { kind: "loadStarted", key: fieldKey(run, 3) });
  const changed = present(loading, { kind: "timeSelected", step: 6 });
  assert.equal(present(changed, { kind: "fieldLoaded", key: fieldKey(run, 3), field }), changed);
  assert.equal(changed.step, 6);
});

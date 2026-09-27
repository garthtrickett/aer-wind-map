import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldKey, historyKey, initialState, nap, present } from "./model.ts";
import type { HistoricalData } from "./history.ts";
import type { WindField } from "./wind.ts";

const run = { date: "20260925", hour: 18, id: "2026092518", startedAt: "2026-09-25T18:00:00Z" };
const field: WindField = { kind: "wind", run, step: 3, width: 1, height: 1, firstLatitude: 0, firstLongitude: 0, increment: 1, u: new Float32Array([1]), v: new Float32Array([0]), gust: null };

test("SAM loading accepts only the requested forecast", () => {
  const readyToLoad = present(initialState, { kind: "runFound", run, layer: "wind" });
  assert.deepEqual(nap(readyToLoad), { kind: "load", run, step: 3, key: fieldKey(run, 3), layer: "wind" });
  const loading = present(readyToLoad, { kind: "loadStarted", key: fieldKey(run, 3) });
  assert.equal(present(loading, { kind: "fieldLoaded", key: "old:3", field }), loading);
  assert.equal(present(loading, { kind: "fieldLoaded", key: fieldKey(run, 3), field }).phase, "ready");
});

test("time changes discard an in-flight response", () => {
  const loading = present(present(initialState, { kind: "runFound", run, layer: "wind" }), { kind: "loadStarted", key: fieldKey(run, 3) });
  const changed = present(loading, { kind: "timeSelected", step: 6 });
  assert.equal(present(changed, { kind: "fieldLoaded", key: fieldKey(run, 3), field }), changed);
  assert.equal(changed.step, 6);
});

test("switching layers rejects stale data and selects the wave stream", () => {
  const loadingWind = present(present(initialState, { kind: "runFound", run, layer: "wind" }), { kind: "loadStarted", key: fieldKey(run, 3) });
  const waves = present(loadingWind, { kind: "layerSelected", layer: "waves" });
  assert.equal(waves.layer, "waves");
  assert.deepEqual(nap(waves), { kind: "discover", layer: "waves" });
  assert.equal(present(waves, { kind: "fieldLoaded", key: fieldKey(run, 3), field }), waves);
  assert.equal(present(waves, { kind: "runFound", run, layer: "wind" }), waves);
  const ready = present(waves, { kind: "runFound", run, layer: "waves" });
  assert.deepEqual(nap(ready), { kind: "load", run, step: 3, key: fieldKey(run, 3, "waves"), layer: "waves" });
});

test("a selected flag can move, open details, and be removed", () => {
  const first = { latitude: 20, longitude: 30 };
  const second = { latitude: 24, longitude: 35 };
  const selected = present(initialState, { kind: "locationSelected", point: first });
  assert.deepEqual(selected.selected, first);
  assert.equal(selected.modalOpen, false);

  const moved = present(selected, { kind: "locationDragged", point: second });
  assert.deepEqual(moved.selected, second);
  assert.equal(moved.modalOpen, false);
  assert.equal(present(moved, { kind: "detailsOpened" }).modalOpen, true);
  assert.deepEqual(present(moved, { kind: "selectionCleared" }).selected, null);
});

test("historical results belong to the selected spot and criteria rescore cached data", () => {
  const point = { latitude: -8.85, longitude: 115.1 };
  const selected = present(initialState, { kind: "locationSelected", point });
  const opened = present(selected, { kind: "historyOpened" });
  const key = historyKey(point, opened.history.startYear, opened.history.endYear);
  assert.deepEqual(nap(opened), { kind: "loadHistory", point,
    startYear: opened.history.startYear, endYear: opened.history.endYear, key });
  const loading = present(opened, { kind: "historyLoadStarted", key });
  const data: HistoricalData = {
    startYear: opened.history.startYear, endYear: opened.history.endYear, timezone: "Asia/Makassar",
    waveGrid: point, windGrid: point, hours: [],
  };
  const changedSpot = present(loading, { kind: "locationSelected", point: { latitude: -9, longitude: 115 } });
  assert.equal(present(changedSpot, { kind: "historyLoaded", key, data }), changedSpot);
  const ready = present(loading, { kind: "historyLoaded", key, data });
  assert.equal(ready.history.phase, "ready");
  const rescored = present(ready, { kind: "historyCriteriaChanged", criteria: { ...ready.history.criteria, maxWindSpeed: 3 } });
  assert.equal(rescored.history.data, data);
  assert.equal(nap(rescored)?.kind, "discover");
});

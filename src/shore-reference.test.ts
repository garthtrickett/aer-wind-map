import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeBearing, relativeRange, shoreLineBearing, shoreNormalFromLine, shoreHandleBearing, shoreNormalFromHandle, wrapBearing } from "./shore-reference.ts";
import { draftSavedSpot, initialState, present } from "./model.ts";
import { forecastAlertKey } from "./forecast-alerts.ts";
import { isSavedSpot, readSavedSpots, writeSavedSpots } from "./saved-spots.ts";

test("relative ranges use opposite wind/swell references, preserve north crossings and clockwise widths", () => {
  assert.deepEqual(relativeRange(45, 135, wrapBearing(270 + 180)), { start: -45, end: 45, span: 90 });
  assert.deepEqual(relativeRange(240, 300, 270), { start: -30, end: 30, span: 60 });
  assert.equal(relativeBearing(350, 10), -20);
  assert.equal(relativeBearing(10, 350), 20);
  assert.equal(relativeBearing(360, 0), 0);
  assert.equal(relativeBearing(180, 0), -180);
  assert.deepEqual(relativeRange(0, 360, 270), { start: 90, end: 90, span: 360 });
  assert.equal(relativeRange(45, 315, 0).span, 270);
  assert.equal(relativeRange(90, 90, 90).span, 0, "Equal endpoints select one bearing");
});

test("beach alignment retains its sea side through north; both line dots rotate the same reference", () => {
  assert.equal(shoreLineBearing(270), 0);
  assert.equal(shoreLineBearing(90), 0, "Flipping sea side preserves line alignment");
  assert.equal(shoreNormalFromLine(179, 270), 269);
  assert.equal(shoreNormalFromLine(0, 269), 270);
  assert.equal(shoreNormalFromLine(0, 89), 90);
  assert.ok(Number.isNaN(shoreNormalFromLine(180, 270)));
  for (const normal of [0, 1, 90, 179, 180, 270, 359]) for (const handle of ["shoreLineStart", "shoreLineEnd"] as const)
    assert.equal(shoreNormalFromHandle(shoreHandleBearing(normal, handle), handle), normal);
});

test("reference edits remain drafts and preserve conditions, loaded data and alert keys", () => {
  let state = present(present(initialState, { kind: "locationSelected", point: { latitude: 11, longitude: 119 } }), { kind: "historyOpened" });
  state = present(state, { kind: "savedSpotNameChanged", name: "Beach" });
  const before = state;
  state = present(state, { kind: "historyShoreNormalChanged", normal: 315 });
  assert.equal(state.history.criteria, before.history.criteria);
  assert.equal(state.history.data, before.history.data);
  assert.equal(state.history.forecastPreview, before.history.forecastPreview);
  assert.equal(state.compassForecast, before.compassForecast);
  assert.equal(state.savedSpots, before.savedSpots);
  assert.equal(forecastAlertKey(draftSavedSpot(state.history)), forecastAlertKey(draftSavedSpot(before.history)));
  state = present(state, { kind: "savedSpotSaved", id: "beach" });
  assert.equal(state.savedSpots[0].shoreNormal, 315);
  state = present(state, { kind: "historyShoreNormalChanged", normal: 0 });
  state = present(state, { kind: "savedSpotSaved", id: "copy" });
  assert.equal(state.savedSpots.find((spot) => spot.id === "copy")?.shoreNormal, 0);
  state = present(state, { kind: "savedSpotOpened", id: "beach" });
  assert.equal(state.history.shoreNormal, 315);
  for (const normal of [-1, 360, 90.5, NaN, Infinity]) assert.equal(present(state, { kind: "historyShoreNormalChanged", normal }), state);
  state = present(state, { kind: "historyShoreNormalChanged", normal: null });
  assert.equal(state.history.shoreNormal, null);
  state = present(state, { kind: "savedSpotOpened", id: "beach" });
  assert.equal(state.history.shoreNormal, 315);
  state = present(state, { kind: "telegramSpotRestored", spot: state.savedSpots.find((spot) => spot.id === "copy")!, readOnly: true });
  assert.equal(state.history.shoreNormal, 0);
  state = present(state, { kind: "locationSelected", point: { latitude: 12, longitude: 120 } });
  assert.equal(state.history.shoreNormal, null);
});

test("optional alignment round-trips in storage; legacy presets have no alignment", () => {
  const opened = present(present(initialState, { kind: "locationSelected", point: { latitude: 11, longitude: 119 } }), { kind: "historyOpened" });
  const spot = draftSavedSpot(opened.history);
  const { shoreNormal: _, ...legacy } = spot;
  for (const shoreNormal of [null, 0, 90, 359]) {
    const saved = { ...spot, shoreNormal, id: "new" };
    let text: string | null = null;
    const storage = { getItem: () => text, setItem: (_key: string, value: string) => { text = value; } };
    assert.deepEqual(writeSavedSpots(() => storage, [saved, legacy]), { ok: true });
    assert.deepEqual(readSavedSpots(() => storage), { ok: true, value: [saved, legacy] });
  }
  for (const shoreNormal of [-1, 360, 1.5, "90", NaN]) assert.equal(isSavedSpot({ ...spot, shoreNormal }), false);
  assert.equal(present({ ...initialState, savedSpots: [legacy] }, { kind: "savedSpotOpened", id: legacy.id }).history.shoreNormal, null);
});

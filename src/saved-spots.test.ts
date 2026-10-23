import assert from "node:assert/strict";
import { test } from "node:test";
import { isSavedSpot, readSavedSpots, writeSavedSpots, type SavedSpot } from "./saved-spots.ts";
import { defaultHistoryCriteria } from "./history.ts";

const spot: SavedSpot = {
  id: "spot-1", name: "Wet season Bukit", point: { latitude: -8.78, longitude: 115.07 },
  startYear: 2023, endYear: 2025,
  criteria: { ...defaultHistoryCriteria, maxSwellPeriod: 14, windFromStart: 315, windFromEnd: 45,
    swellFromStart: 180, swellFromEnd: 270 },
  alertEnabled: true, alertMinDays: 3,
};

test("named spots and criteria round-trip through browser storage", () => {
  let text: string | null = null;
  const storage = { getItem: () => text, setItem: (_key: string, value: string) => { text = value; } };
  assert.deepEqual(readSavedSpots(() => storage), { ok: true, value: [] });
  assert.deepEqual(writeSavedSpots(() => storage, [spot]), { ok: true });
  assert.deepEqual(readSavedSpots(() => storage), { ok: true, value: [spot] });
});

test("malformed storage and denied storage return typed errors", () => {
  const invalid = { getItem: () => JSON.stringify({ version: 1, spots: [{ ...spot, criteria: { ...spot.criteria, windFromEnd: 999 } }] }),
    setItem: () => undefined };
  assert.deepEqual(readSavedSpots(() => invalid), { ok: false, error: { kind: "invalid" } });
  const invalidThreshold = { ...invalid, getItem: () => JSON.stringify({ version: 1, spots: [{ ...spot, alertMinDays: 15 }] }) };
  assert.deepEqual(readSavedSpots(() => invalidThreshold), { ok: false, error: { kind: "invalid" } });
  const denied = () => { throw new Error("Storage blocked"); };
  assert.deepEqual(readSavedSpots(denied), { ok: false, error: { kind: "unavailable" } });
  assert.deepEqual(writeSavedSpots(denied, [spot]), { ok: false, error: { kind: "unavailable" } });
});

test("older saved spots retain their rules with no maximum swell period", () => {
  const { maxSwellPeriod, ...legacyCriteria } = spot.criteria;
  const legacy = { ...spot, criteria: legacyCriteria };
  const text = JSON.stringify({ version: 1, spots: [legacy] });
  const storage = { getItem: () => text, setItem: () => undefined };
  assert.deepEqual(readSavedSpots(() => storage), {
    ok: true, value: [{ ...spot, criteria: { ...legacyCriteria, maxSwellPeriod: null } }],
  });
  for (const maximum of [9, -1, 31, "14"]) {
    const invalid = { ...storage, getItem: () => JSON.stringify({ version: 1,
      spots: [{ ...spot, criteria: { ...spot.criteria, maxSwellPeriod: maximum } }] }) };
    assert.deepEqual(readSavedSpots(() => invalid), { ok: false, error: { kind: "invalid" } });
  }
});


test("multiple alert rows round-trip and invalid counts are rejected at browser/server validation", () => {
  const multiple = { ...spot, alertRules: [{ minDays: 2, withinDays: 4 }, { minDays: 4, withinDays: 7 }] };
  const storage = { getItem: () => JSON.stringify({ version: 1, spots: [multiple] }), setItem: () => undefined };
  assert.deepEqual(readSavedSpots(() => storage), { ok: true, value: [multiple] });
  for (const rules of [[], [{ minDays: 0, withinDays: 4 }], [{ minDays: 5, withinDays: 4 }],
    [{ minDays: 2, withinDays: 15 }], [{ minDays: 1.5, withinDays: 4 }], [{ minDays: 2, withinDays: "4" }],
    Array.from({ length: 15 }, () => ({ minDays: 1, withinDays: 4 }))]) {
    assert.equal(isSavedSpot({ ...spot, alertRules: rules }), false);
  }
  assert.equal(isSavedSpot(spot), true, "existing single-threshold snapshots remain valid");
});


test("saved look-ahead round-trips and invalid horizons are rejected", () => {
  const saved = { ...spot, alertLookAheadDays: 7 };
  assert.deepEqual(readSavedSpots(() => ({ getItem: () => JSON.stringify({ version: 1, spots: [saved] }), setItem: () => undefined })), { ok: true, value: [saved] });
  for (const alertLookAheadDays of [0, 15, 2.5, "7", null]) assert.equal(isSavedSpot({ ...spot, alertLookAheadDays }), false);
});

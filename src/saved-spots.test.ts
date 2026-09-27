import assert from "node:assert/strict";
import { test } from "node:test";
import { readSavedSpots, writeSavedSpots, type SavedSpot } from "./saved-spots.ts";
import { defaultHistoryCriteria } from "./history.ts";

const spot: SavedSpot = {
  id: "spot-1", name: "Wet season Bukit", point: { latitude: -8.78, longitude: 115.07 },
  startYear: 2023, endYear: 2025,
  criteria: { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45,
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

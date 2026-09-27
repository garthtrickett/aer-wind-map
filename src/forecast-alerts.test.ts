import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreForecastAlert } from "./forecast-alerts.ts";
import { defaultHistoryCriteria } from "./history.ts";
import type { SavedSpot } from "./saved-spots.ts";

const start = Date.parse("2026-09-27T00:00:00Z") / 1000;
const time = Array.from({ length: 15 * 24 }, (_, index) => start + index * 3600);
const matching = new Set([25, 26, 73, 74, 95, 97]);
const spot: SavedSpot = {
  id: "bukit", name: "Wet season Bukit", point: { latitude: -8.78, longitude: 115.07 },
  startYear: 2023, endYear: 2025, alertEnabled: true, alertMinDays: 2,
  criteria: { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45,
    swellFromStart: 180, swellFromEnd: 270 },
};
const wave = { timezone: "UTC", time, first: time.map(() => 2), second: time.map(() => 12), third: time.map(() => 220) };
const wind = { timezone: "UTC", time, first: time.map(() => 3), second: time.map((_, index) => matching.has(index) ? 355 : 180), third: null };

test("14-day alerts require consecutive matching hours on each local day", () => {
  const summary = scoreForecastAlert(spot, wave, wind, new Date("2026-09-27T00:00:00Z"));
  assert.ok(summary);
  assert.equal(summary.horizonDays, 14);
  assert.equal(summary.availableDays, 14);
  assert.equal(summary.requiredHours, 2);
  assert.equal(summary.matchingDays, 2);
  assert.equal(summary.nextWindowStart, time[25]);
  assert.equal(scoreForecastAlert({ ...spot, criteria: { ...spot.criteria, minConsecutiveHours: 3 } },
    wave, wind, new Date("2026-09-27T00:00:00Z"))?.matchingDays, 0);
  assert.equal(scoreForecastAlert({ ...spot, criteria: { ...spot.criteria, minConsecutiveHours: 1 } },
    wave, wind, new Date("2026-09-27T00:00:00Z"))?.requiredHours, 2);
});

test("expired hours and missing paired wave data do not become alert days", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const summary = scoreForecastAlert(spot, wave, wind, now);
  assert.equal(summary?.matchingDays, 1);
  const noWave = { ...wave, first: time.map(() => null) };
  assert.equal(scoreForecastAlert(spot, noWave, wind, now), null);
});

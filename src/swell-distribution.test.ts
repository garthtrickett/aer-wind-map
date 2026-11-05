import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHistoryCriteria, type HistoricalData, type HistoricalHour } from "./history.ts";
import { monthlySwellDistribution, swellHeightBands, swellPeriodBands } from "./swell-distribution.ts";

const hour = (changes: Partial<HistoricalHour> = {}): HistoricalHour => ({
  time: Date.parse("2025-01-01T06:00:00Z") / 1000, day: "2025-01-01",
  swellHeight: 1, swellPeriod: 11, swellDirection: 220, windSpeed: 3, windDirection: 90, ...changes,
});
const data = (hours: HistoricalHour[], changes: Partial<HistoricalData> = {}): HistoricalData => ({
  startYear: 2025, endYear: 2025, timezone: "UTC", waveGrid: { latitude: 0, longitude: 0 },
  windGrid: { latitude: 0, longitude: 0 }, hours, ...changes,
});
const swellOnly = { ...defaultHistoryCriteria, conditions: "swell" as const };

test("joint swell bins partition every boundary exactly once and retain height-period pairing", () => {
  const hours = swellHeightBands.flatMap((height) => swellPeriodBands.map((period) =>
    hour({ swellHeight: height.min, swellPeriod: period.min })));
  hours.push(hour({ swellHeight: 8, swellPeriod: 25 }));
  const result = monthlySwellDistribution(data(hours), swellOnly, 0)!;
  assert.equal(result.availableHours, 36);
  assert.equal(result.includedHours, 36);
  assert.equal(result.cells.flat().reduce((a, b) => a + b), 36);
  assert.deepEqual(result.cells, Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => row === 4 && column === 6 ? 2 : 1)));
});

test("short periods distinguish below six, six to eight, and eight to ten seconds", () => {
  const result = monthlySwellDistribution(data([5.999, 6, 7.999, 8].map((swellPeriod) =>
    hour({ swellHeight: 1, swellPeriod }))), swellOnly, 0)!;
  assert.deepEqual(result.cells[1], [1, 2, 1, 0, 0, 0, 0]);
});

test("combined distribution counts joint wind passes against ALL paired hours and reuses calm rules", () => {
  const result = monthlySwellDistribution(data([
    hour(), // Normal offshore.
    hour({ windDirection: 270 }), // Known onshore stays in denominator.
    hour({ windSpeed: 2 / 3.6, windDirection: null }), // Calm overrides missing direction.
    hour({ windSpeed: 2.01 / 3.6, windDirection: 270 }),
    hour({ windSpeed: 8 }), // Too strong stays in denominator.
    hour({ windSpeed: null }), // Unknown wind is excluded entirely.
    hour({ windDirection: null }),
  ]), defaultHistoryCriteria, 0)!;
  assert.equal(result.availableHours, 5);
  assert.equal(result.includedHours, 2);
  assert.equal(result.cells[1][3], 2);
  assert.equal(result.withGoodWind, true);
});

test("distribution ignores swell filters and minimum window, and swell-only needs no wind", () => {
  const observations = data([hour({ swellHeight: .2, swellPeriod: 7, swellDirection: null, windSpeed: null, windDirection: null })]);
  const result = monthlySwellDistribution(observations, { ...swellOnly, minConsecutiveHours: 12,
    minSwellHeight: 2, minSwellPeriod: 15, swellFromStart: 0, swellFromEnd: 1 }, 0)!;
  assert.equal(result.availableHours, 1);
  assert.equal(result.cells[0][1], 1);
  assert.equal(result.withGoodWind, false);
  assert.equal(monthlySwellDistribution(observations, { ...swellOnly, conditions: "wind" }, 0), null);
});

test("distribution uses the selected LOCAL month, daylight hours and requested years", () => {
  const local = (date: string, time: string) => hour({ day: date, time: Date.parse(time) / 1000 });
  const result = monthlySwellDistribution(data([
    local("2025-01-01", "2024-12-31T21:00:00Z"), // 05:00 excluded.
    local("2025-01-01", "2024-12-31T22:00:00Z"), // 06:00 included despite UTC year.
    local("2025-01-01", "2025-01-01T09:00:00Z"), // 17:00 included.
    local("2025-01-01", "2025-01-01T10:00:00Z"), // 18:00 excluded.
    local("2025-02-01", "2025-01-31T22:00:00Z"),
    local("2024-01-01", "2023-12-31T22:00:00Z"),
  ], { timezone: "Asia/Makassar" }), swellOnly, 0)!;
  assert.equal(result.availableHours, 2);
  assert.equal(result.expectedHours, 31 * 12);
  assert.equal(monthlySwellDistribution(data([], { startYear: 2024 }), swellOnly, 1)!.expectedHours, (29 + 28) * 12);
});

test("missing and invalid data never looks flat, and a known zero distribution is distinguishable", () => {
  const observations = data([hour({ swellHeight: null }), hour({ swellPeriod: null }),
    hour({ swellHeight: -1 }), hour({ swellPeriod: NaN }), hour({ swellHeight: Infinity })]);
  const missing = monthlySwellDistribution(observations, swellOnly, 0)!;
  assert.equal(missing.availableHours, 0);
  const failedWind = monthlySwellDistribution(data([hour({ windDirection: 270 })]), defaultHistoryCriteria, 0)!;
  assert.equal(failedWind.availableHours, 1);
  assert.equal(failedWind.includedHours, 0);
  assert.equal(monthlySwellDistribution(observations, swellOnly, 12), null);
});

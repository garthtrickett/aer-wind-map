import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHistoryCriteria, type HistoricalData, type HistoricalHour } from "./history.ts";
import { monthlyWindDistribution, windDirections, windSpeedBands } from "./wind-distribution.ts";

const hour = (changes: Partial<HistoricalHour> = {}): HistoricalHour => ({
  time: Date.parse("2025-01-01T06:00:00Z") / 1000, day: "2025-01-01",
  swellHeight: null, swellPeriod: null, swellDirection: null, windSpeed: 3, windDirection: 45, ...changes,
});
const data = (hours: HistoricalHour[], changes: Partial<HistoricalData> = {}): HistoricalData => ({
  startYear: 2025, endYear: 2025, timezone: "UTC", waveGrid: { latitude: 0, longitude: 0 },
  windGrid: { latitude: 0, longitude: 0 }, hours, ...changes,
});
const windOnly = { ...defaultHistoryCriteria, conditions: "wind" as const };

test("wind speed boundaries convert from m/s to km/h and partition every joint bin", () => {
  const hours = windDirections.flatMap((_, row) => windSpeedBands.map((band) =>
    hour({ windDirection: row * 45, windSpeed: band.min / 3.6 })));
  hours.push(hour({ windDirection: 360, windSpeed: 100 / 3.6 }));
  const result = monthlyWindDistribution(data(hours), windOnly, 0)!;
  assert.equal(result.availableHours, 41);
  assert.equal(result.calmHours, 0);
  assert.deepEqual(result.cells, Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 5 }, (_, column) => row === 0 && column === 4 ? 2 : 1)));
});

test("compass sectors centre on directions and wrap through north without overlapping", () => {
  const angles = [0, 22.499, 22.5, 67.499, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.499, 337.5, 359.99, 360];
  const result = monthlyWindDistribution(data(angles.map((windDirection) => hour({ windDirection }))), windOnly, 0)!;
  assert.deepEqual(result.cells.map((row) => row.reduce((a, b) => a + b)), [5, 2, 1, 1, 1, 1, 1, 2]);
  assert.equal(result.availableHours, angles.length);
});

test("calm has a fixed <2 km/h boundary, needs no direction and shares the denominator", () => {
  const observations = data([
    hour({ windSpeed: 0, windDirection: null }),
    hour({ windSpeed: 1.999 / 3.6, windDirection: null }),
    hour({ windSpeed: 2 / 3.6, windDirection: 45 }),
    hour({ windSpeed: 2 / 3.6, windDirection: null }),
    hour({ windSpeed: 10 / 3.6, windDirection: 270 }),
  ]);
  const result = monthlyWindDistribution(observations, { ...windOnly, calmWindKmh: 10, maxWindSpeed: 0,
    windFromStart: 0, windFromEnd: 0, minConsecutiveHours: 12 }, 0)!;
  assert.equal(result.availableHours, 4);
  assert.equal(result.calmHours, 2);
  assert.equal(result.cells[1][0], 1);
  assert.equal(result.cells[6][2], 1);
  assert.equal(result.cells.flat().reduce((a, b) => a + b) + result.calmHours, result.availableHours);
  assert.deepEqual(result, monthlyWindDistribution(observations, defaultHistoryCriteria, 0));
});

test("wind uses local daytime, selected month and requested years including leap years", () => {
  const local = (day: string, time: string) => hour({ day, time: Date.parse(time) / 1000 });
  const result = monthlyWindDistribution(data([
    local("2025-01-01", "2024-12-31T21:00:00Z"),
    local("2025-01-01", "2024-12-31T22:00:00Z"),
    local("2025-01-01", "2025-01-01T09:00:00Z"),
    local("2025-01-01", "2025-01-01T10:00:00Z"),
    local("2025-02-01", "2025-01-31T22:00:00Z"),
    local("2024-01-01", "2023-12-31T22:00:00Z"),
  ], { timezone: "Asia/Makassar" }), windOnly, 0)!;
  assert.equal(result.availableHours, 2);
  assert.equal(result.expectedHours, 31 * 12);
  assert.equal(monthlyWindDistribution(data([], { startYear: 2024 }), windOnly, 1)!.expectedHours, 57 * 12);
});

test("missing and invalid wind never becomes calm; swell-only markers have no wind table", () => {
  const missing = monthlyWindDistribution(data([
    hour({ windSpeed: null }), hour({ windSpeed: -1 }), hour({ windSpeed: NaN }), hour({ windSpeed: Infinity }),
    hour({ windDirection: null }), hour({ windDirection: NaN }), hour({ windDirection: -1 }), hour({ windDirection: 361 }),
  ]), windOnly, 0)!;
  assert.equal(missing.availableHours, 0);
  assert.equal(missing.calmHours, 0);
  assert.equal(monthlyWindDistribution(data([]), { ...windOnly, conditions: "swell" }, 0), null);
  for (const month of [-1, 12, 1.5, NaN]) assert.equal(monthlyWindDistribution(data([]), windOnly, month), null);
});

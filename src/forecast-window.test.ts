import assert from "node:assert/strict";
import { test } from "node:test";
import { forecastWindowConditions } from "./forecast-window.ts";
import { defaultHistoryCriteria } from "./history.ts";
import type { SavedSpot } from "./saved-spots.ts";
import type { ForecastData } from "./forecast-alerts.ts";

const first = Date.parse("2026-10-30T06:00:00Z") / 1000;
const time = Array.from({ length: 4 }, (_, hour) => first + hour * 3600);
const spot: SavedSpot = { id: "test", name: "Beach", point: { latitude: 16, longitude: 120 },
  startYear: 2025, endYear: 2025, criteria: defaultHistoryCriteria, alertEnabled: true, alertMinDays: 1 };
const data: ForecastData = {
  wind: { time, timezone: "UTC", first: [1, 2, 3, 40], second: [350, 10, 45, 180], third: null },
  wave: { time, timezone: "UTC", first: [1, 1.5, 2, 9], second: [7, 8, 9, 20], third: [40, 50, 60, 220] },
};
const window = { day: "2026-10-30", start: first, end: first + 3 * 3600 };

test("window conditions use only matching samples, exclude the end and convert wind to km/h", () => {
  const [point] = forecastWindowConditions(spot, data, window);
  assert.deepEqual(point.hours.map((hour) => hour.time), time.slice(0, 3));
  assert.deepEqual(point.wind?.speed, { min: 3.6, max: 10.8 });
  assert.deepEqual(point.swell?.height, { min: 1, max: 2 });
  assert.deepEqual(point.swell?.period, { min: 7, max: 9 });
  assert.deepEqual(point.wind?.directions, [350, 10, 45], "Do not average bearings across north");
  assert.deepEqual(point.swell?.directions, [40, 50, 60]);
});

test("linked wind and swell values come from their own markers and exact shared UTC samples", () => {
  const offshore: SavedSpot = { ...spot, name: "Offshore swell", criteria: { ...spot.criteria, conditions: "swell" } };
  const coastal: SavedSpot = { ...spot, id: "coast", name: "Sheltered wind", criteria: { ...spot.criteria, conditions: "wind" } };
  const [swell, wind] = forecastWindowConditions(offshore, { ...data, linked: [{ spot: coastal,
    wave: { ...data.wave, first: [100, 100, 100, 100] },
    wind: { ...data.wind, timezone: "Asia/Taipei", first: [.5, 1, 1.5, 100], second: [30, 50, 70, 200] } }] }, window);
  assert.equal(swell.name, "Offshore swell");
  assert.equal(swell.wind, null);
  assert.deepEqual(swell.swell?.height, { min: 1, max: 2 });
  assert.equal(wind.name, "Sheltered wind");
  assert.equal(wind.swell, null);
  assert.deepEqual(wind.wind?.speed, { min: 1.8, max: 5.4 });
  assert.deepEqual(wind.hours.map((hour) => hour.time), time.slice(0, 3));
  assert.deepEqual(wind.wind?.directions, [30, 50, 70]);
});

test("unknown samples stay unknown and calm is not assigned a north bearing", () => {
  const missing: ForecastData = { ...data,
    wind: { ...data.wind, time: [time[0]], first: [0], second: [0] },
    wave: { ...data.wave, time: [time[0]], first: [null], second: [null], third: [null] } };
  const [point] = forecastWindowConditions(spot, missing, window);
  assert.deepEqual(point.wind?.speed, { min: 0, max: 0 });
  assert.equal(point.wind?.calm, false, "A missing hour must not be called calm");
  assert.deepEqual(point.wind?.directions, [null, null, null]);
  assert.equal(point.hours[1].wind, null);
  assert.equal(point.swell?.height, null);
  assert.equal(point.swell?.period, null);
  const [calm] = forecastWindowConditions(spot, missing, { ...window, end: first + 3600 });
  assert.equal(calm.wind?.calm, true);
});

test("window readings preserve half-hour-offset provider timestamps", () => {
  const shifted = time.map((t) => t + 1800);
  const [point] = forecastWindowConditions(spot, { wind: { ...data.wind, time: shifted }, wave: { ...data.wave, time: shifted } },
    { ...window, start: first + 1800, end: first + 9000 });
  assert.deepEqual(point.hours.map((hour) => hour.time), shifted.slice(0, 2));
  assert.deepEqual(point.wind?.speed, { min: 3.6, max: 7.2 });
  assert.deepEqual(point.swell?.height, { min: 1, max: 1.5 });
});

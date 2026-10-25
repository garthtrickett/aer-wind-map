import assert from "node:assert/strict";
import test from "node:test";
import { dayHours, loadDay, validLookupDate } from "./day-lookup.ts";
import { initialState, nap, present } from "./model.ts";

const point = { latitude: 22.952, longitude: 121.295 };
const date = "2025-10-24";
const midnight = Date.parse(`${date}T00:00:00+08:00`) / 1000;
const time = Array.from({ length: 24 }, (_, index) => midnight + index * 3600);
const wind = (times = time) => ({ latitude: 23.022846, longitude: 121.31661, timezone: "Asia/Taipei", hourly: {
  time: times, wind_speed_10m: times.map(() => 3.6), wind_direction_10m: times.map(() => 355),
} });
const waves = (times = time) => ({ latitude: 22.958336, longitude: 121.375015, timezone: "Asia/Taipei", hourly: {
  time: times, swell_wave_height: times.map(() => 1.2), swell_wave_period: times.map(() => 8), swell_wave_direction: times.map(() => 65),
  wave_height: times.map(() => 1.7), wave_period: times.map(() => 6), wave_direction: times.map(() => 75),
} });
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const fetcher = (async (input) => response(String(input).includes("archive-api") ? wind() : waves())) as typeof fetch;

test("day lookup requests only one date in local time and separates swell from combined waves", async () => {
  const urls: URL[] = [];
  const result = await loadDay(point, date, (async (input) => {
    urls.push(new URL(String(input)));
    return fetcher(input);
  }) as typeof fetch);
  assert.ok(result.ok);
  assert.equal(result.data.timezone, "Asia/Taipei");
  assert.equal(result.data.hours.length, 24);
  assert.equal(result.data.hours[0].windSpeed, 3.6);
  assert.equal(result.data.hours[0].swellHeight, 1.2);
  assert.equal(result.data.hours[0].waveHeight, 1.7);
  assert.deepEqual(result.data.wind.grid, { latitude: 23.022846, longitude: 121.31661 });
  for (const url of urls) {
    assert.equal(url.searchParams.get("start_date"), date);
    assert.equal(url.searchParams.get("end_date"), date);
    assert.equal(url.searchParams.get("timezone"), "auto");
    assert.equal(url.searchParams.get("cell_selection"), "sea");
  }
  assert.equal(urls.find((url) => url.hostname.startsWith("archive"))?.searchParams.get("wind_speed_unit"), "kmh");
  assert.deepEqual(dayHours(result.data, 6, 18).map((row) => row.time), time.slice(6, 18));
  assert.equal(dayHours(result.data, 0, 24).length, 24);
});

test("joins sources by UTC instant, preserving missing hours and values", async () => {
  const result = await loadDay(point, date, (async (input) => {
    if (String(input).includes("archive-api")) {
      const data = wind(time.filter((_, index) => index !== 6));
      return response(data);
    }
    const data = waves();
    return response({ ...data, hourly: { ...data.hourly, swell_wave_height: time.map((_, index) => index === 7 ? null : 1.2) } });
  }) as typeof fetch);
  assert.ok(result.ok);
  assert.equal(result.data.hours[6].windSpeed, null);
  assert.equal(result.data.hours[6].swellHeight, 1.2);
  assert.equal(result.data.hours[7].windDirection, 355);
  assert.equal(result.data.hours[7].swellHeight, null);
  assert.equal(result.data.hours[7].waveHeight, 1.7);
});

test("keeps successful source when the other source fails", async () => {
  for (const failed of ["archive-api", "marine-api"]) {
    const result = await loadDay(point, date, (async (input) => String(input).includes(failed)
      ? new Response("unavailable", { status: 503 }) : fetcher(input)) as typeof fetch);
    assert.ok(result.ok);
    assert.equal(result.data.hours.length, 24);
    assert.match((failed === "archive-api" ? result.data.wind : result.data.waves).issue!, /503/);
    assert.equal(failed === "archive-api" ? result.data.hours[0].windSpeed : result.data.hours[0].waveHeight, null);
  }
});

test("rejects impossible or unsupported dates before fetching", async () => {
  for (const bad of ["2025-02-29", "2025-02-30", "2021-12-31", "", "2025-1-02", "2099-01-01"]) {
    const result = await loadDay(point, bad, (async () => { throw new Error("Must not fetch"); }) as typeof fetch);
    assert.equal(result.ok, false);
  }
  assert.equal(validLookupDate("2024-02-29"), true);
});

test("reports failure for unusable sources and never fabricates calm or flat readings", async () => {
  assert.equal((await loadDay(point, date, (async () => response({ hourly: {} })) as typeof fetch)).ok, false);
  const data = wind();
  const result = await loadDay(point, date, (async (input) => String(input).includes("archive-api")
    ? response({ ...data, timezone: "not/a/timezone" }) : response(waves())) as typeof fetch);
  assert.ok(result.ok);
  assert.equal(result.data.wind.grid, null);
  assert.equal(result.data.hours[0].windSpeed, null);
});

test("local-hour filtering handles a 25-hour daylight-saving day", () => {
  const start = Date.parse("2025-11-02T00:00:00-04:00") / 1000;
  const hours = Array.from({ length: 25 }, (_, index) => ({ time: start + index * 3600,
    windSpeed: 0, windDirection: null, swellHeight: null, swellPeriod: null, swellDirection: null,
    waveHeight: null, wavePeriod: null, waveDirection: null }));
  const data = { date: "2025-11-02", timezone: "America/New_York", wind: { grid: null, issue: null }, waves: { grid: null, issue: null }, hours };
  assert.equal(dayHours(data, 0, 24).length, 25);
  assert.equal(dayHours(data, 6, 18).length, 12);
});

test("marker/date changes invalidate in-flight responses; hour changes reuse loaded data", async () => {
  const result = await loadDay(point, date, fetcher);
  let state = present(initialState, { kind: "locationSelected", point });
  state = present(state, { kind: "detailsOpened" });
  state = present(state, { kind: "dayLookupToggled" });
  state = present(state, { kind: "dayLookupDateChanged", date });
  state = present(state, { kind: "dayLookupRequested" });
  const request = state.dayLookup.request;
  assert.equal(nap(state)?.kind, "loadDay");
  state = present(state, { kind: "dayLookupStarted", request });
  const moved = present(state, { kind: "locationSelected", point: { ...point, latitude: 23 } });
  assert.equal(present(moved, { kind: "dayLookupCompleted", request, result }).dayLookup.data, null);
  const changed = present(state, { kind: "dayLookupDateChanged", date: "2025-10-25" });
  assert.equal(present(changed, { kind: "dayLookupCompleted", request, result }).dayLookup.data, null);
  state = present(state, { kind: "dayLookupCompleted", request, result });
  assert.equal(state.dayLookup.phase, "ready");
  const changedHours = present(state, { kind: "dayLookupHoursChanged", start: 6, end: 9 });
  assert.equal(changedHours.dayLookup.data, state.dayLookup.data);
  assert.equal(changedHours.dayLookup.phase, "ready");
});

import assert from "node:assert/strict";
import test from "node:test";
import { dayHours, loadDay, seaLevelTrend, validLookupDate } from "./day-lookup.ts";
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
const tide = (times = time) => ({ latitude: 22.9583, longitude: 121.2917, timezone: "Asia/Taipei", hourly: {
  time: times, sea_level_height_msl: times.map((_, index) => (index - 10) / 10),
} });
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const fetcher = (async (input) => response(String(input).includes("archive-api") ? wind()
  : String(input).includes("meteofrance_currents") ? tide() : waves())) as typeof fetch;

test("day lookup requests only one date in local time and requests primary swell only", async () => {
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
  assert.equal("waveHeight" in result.data.hours[0], false);
  const swellUrl = urls.find((url) => url.searchParams.get("models") === "meteofrance_wave")!;
  assert.equal(swellUrl.searchParams.get("hourly"), "swell_wave_height,swell_wave_period,swell_wave_direction");
  assert.equal(result.data.hours[0].seaLevel, -1, "Negative heights relative to MSL are valid");
  assert.equal(result.data.tide.issue, null);
  assert.equal(urls.length, 3);
  assert.equal(urls.find((url) => url.searchParams.get("models") === "meteofrance_currents")?.searchParams.get("hourly"), "sea_level_height_msl");
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
  assert.equal(result.data.hours[7].swellPeriod, 8);
});

test("keeps successful source when the other source fails", async () => {
  for (const failed of ["archive-api", "marine-api"]) {
    const result = await loadDay(point, date, (async (input) => String(input).includes(failed)
      ? new Response("unavailable", { status: 503 }) : fetcher(input)) as typeof fetch);
    assert.ok(result.ok);
    assert.equal(result.data.hours.length, 24);
    assert.match((failed === "archive-api" ? result.data.wind : result.data.waves).issue!, /503/);
    assert.equal(failed === "archive-api" ? result.data.hours[0].windSpeed : result.data.hours[0].swellHeight, null);
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
    waveHeight: null, wavePeriod: null, waveDirection: null, seaLevel: null }));
  const data = { date: "2025-11-02", timezone: "America/New_York", wind: { grid: null, issue: null },
    waves: { grid: null, issue: null }, tide: { grid: null, issue: null }, hours };
  assert.equal(dayHours(data, 0, 24).length, 25);
  assert.equal(dayHours(data, 6, 18).length, 12);
});

test("tide survives failed wind and waves, with its own grid and local timezone", async () => {
  const result = await loadDay(point, date, (async (input) => String(input).includes("meteofrance_currents")
    ? response(tide()) : new Response("unavailable", { status: 503 })) as typeof fetch);
  assert.ok(result.ok);
  assert.equal(result.data.timezone, "Asia/Taipei");
  assert.equal(result.data.hours.length, 24);
  assert.equal(result.data.hours[6].seaLevel, -.4);
  assert.equal(result.data.hours[6].windSpeed, null);
  assert.equal(result.data.hours[6].swellHeight, null);
  assert.deepEqual(result.data.tide.grid, { latitude: 22.9583, longitude: 121.2917 });
});

test("tide failures and all-null archives do not remove wind or waves or fabricate zero tide", async () => {
  for (const unavailable of [new Response("unavailable", { status: 503 }), response({ ...tide(), hourly: {
    time, sea_level_height_msl: time.map(() => null),
  } })]) {
    const result = await loadDay(point, date, (async (input) => String(input).includes("meteofrance_currents")
      ? unavailable : fetcher(input)) as typeof fetch);
    assert.ok(result.ok);
    assert.ok(result.data.tide.issue);
    assert.equal(result.data.hours[6].seaLevel, null);
    assert.equal(result.data.hours[6].windSpeed, 3.6);
    assert.equal(result.data.hours[6].swellHeight, 1.2);
  }
});

test("tide joins by timestamp, retaining missing readings and excluding a different local date", async () => {
  const result = await loadDay(point, date, (async (input) => {
    if (!String(input).includes("meteofrance_currents")) return fetcher(input);
    const times = [time[0] - 3600, ...time.filter((_, index) => index !== 6)];
    const values = tide(times);
    return response({ ...values, hourly: { ...values.hourly, sea_level_height_msl: times.map((_, index) => index === 7 ? null : -.2) } });
  }) as typeof fetch);
  assert.ok(result.ok);
  assert.equal(result.data.hours.length, 24);
  assert.equal(result.data.hours[0].time, time[0]);
  assert.equal(result.data.hours[6].seaLevel, null);
  assert.equal(result.data.hours[7].seaLevel, null);
  assert.equal(result.data.hours[8].seaLevel, -.2);
});

test("rising and falling use adjacent signed sea levels and never bridge missing hours", async () => {
  const result = await loadDay(point, date, fetcher);
  assert.ok(result.ok);
  const data = result.data;
  assert.equal(seaLevelTrend(data, time[0]), "Rising");
  assert.equal(seaLevelTrend(data, time[10]), "Rising");
  assert.equal(seaLevelTrend(data, time[23]), "Rising");
  const falling = { ...data, hours: data.hours.map((row) => ({ ...row, seaLevel: -row.seaLevel! })) };
  assert.equal(seaLevelTrend(falling, time[10]), "Falling");
  const steady = { ...data, hours: data.hours.map((row) => ({ ...row, seaLevel: 0 })) };
  assert.equal(seaLevelTrend(steady, time[10]), "Steady");
  const gap = { ...data, hours: [data.hours[0], data.hours[3]] };
  assert.equal(seaLevelTrend(gap, time[0]), null);
  assert.equal(seaLevelTrend({ ...data, hours: [{ ...data.hours[0], seaLevel: null }] }, time[0]), null);
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

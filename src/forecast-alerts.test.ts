import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateForecastRules, forecastAlertKey, loadForecastPoint, loadForecastGroup, loadForecastAlerts, scoreForecastAlert, scoreForecastData, type ForecastAlertSummary } from "./forecast-alerts.ts";
import { defaultHistoryCriteria } from "./history.ts";
import type { SavedSpot } from "./saved-spots.ts";

const start = Date.parse("2026-09-27T00:00:00Z") / 1000;
const time = Array.from({ length: 15 * 24 }, (_, index) => start + index * 3600);
const matching = new Set([30, 31, 78, 79, 101, 103]);
const spot: SavedSpot = {
  id: "bukit", name: "Wet season Bukit", point: { latitude: -8.78, longitude: 115.07 },
  startYear: 2023, endYear: 2025, alertEnabled: true, alertMinDays: 2,
  criteria: { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45,
    swellFromStart: 180, swellFromEnd: 270 },
};
const wave = { timezone: "UTC", time, first: time.map(() => 2), second: time.map(() => 12), third: time.map(() => 220) };
const wind = { timezone: "UTC", time, first: time.map(() => 3), second: time.map((_, index) => matching.has(index) ? 355 : 180), third: null };

const offshore: SavedSpot = { ...spot, id: "offshore", name: "Offshore swell", linkedSpotIds: ["coast"],
  criteria: { ...spot.criteria, conditions: "swell" }, alertRules: [{ minDays: 2, withinDays: 4 }] };
const coast: SavedSpot = { ...spot, id: "coast", name: "Nearshore wind", alertEnabled: false,
  criteria: { ...spot.criteria, conditions: "wind" }, alertRules: [{ minDays: 2, withinDays: 4 }] };
const at = new Date("2026-09-27T00:00:00Z");

test("linked swell and wind count shared UTC hours, including an overlap after an earlier daily window", () => {
  const swell = { ...wave, first: time.map((_, i) => [6, 7, 12, 13].includes(i % 24) ? 2 : 0) };
  const localWind = { ...wind, second: time.map((_, i) => [12, 13].includes(i % 24) ? 355 : 180) };
  const data = { wave: swell, wind, linked: [{ spot: coast, wave, wind: localWind }] };
  const summary = scoreForecastData(offshore, data, at)!;
  assert.equal(summary.matchingDays, 14);
  assert.equal(summary.windows[0].start, time[12]);
  assert.equal(summary.windows[0].end, time[14]);
  const result = evaluateForecastRules(summary, offshore.alertRules!);
  assert.equal(result.matched, true);
  assert.equal(result.linked[0].evaluation.matched, true);
  const separateHours = { ...data, linked: [{ spot: coast, wave, wind: { ...localWind,
    second: time.map((_, i) => [8, 9].includes(i % 24) ? 355 : 180) } }] };
  assert.equal(scoreForecastData(offshore, separateHours, at)?.matchingDays, 0);
});

test("linked points cannot pass on separate dates; every point's own day rules must pass", () => {
  const swell = { ...wave, first: time.map((_, i) => Math.floor(i / 24) % 2 === 0 ? 2 : 0) };
  const localWind = { ...wind, second: time.map((_, i) => Math.floor(i / 24) % 2 === 1 ? 355 : 180) };
  assert.equal(scoreForecastData(offshore, { wave: swell, wind, linked: [{ spot: coast, wave, wind: localWind }] }, at)?.matchingDays, 0);
  const twoDays = { ...wave, first: time.map((_, i) => [1, 3].includes(Math.floor(i / 24)) ? 2 : 0) };
  const strict = { ...coast, alertRules: [{ minDays: 3, withinDays: 4 }] };
  const summary = scoreForecastData(offshore, { wave: twoDays, wind,
    linked: [{ spot: strict, wave, wind: { ...wind, second: time.map(() => 355) } }] }, at)!;
  const result = evaluateForecastRules(summary, offshore.alertRules!);
  assert.equal(result.rules[0].met, true);
  assert.equal(result.linked[0].evaluation.matched, false);
  assert.equal(result.matched, false);
  assert.deepEqual(result.windows, []);
});

test("missing linked points fail closed, reciprocal links terminate, and dependency edits change the alert key", async () => {
  const neverFetch: typeof fetch = async () => { throw new Error("missing links must not download"); };
  assert.deepEqual(await loadForecastGroup(offshore, [], neverFetch), { ok: false, error: { kind: "unavailable" } });
  assert.equal(scoreForecastData(offshore, { wave, wind }, at), null);
  const reciprocal = { ...coast, linkedSpotIds: [offshore.id] };
  assert.ok(scoreForecastData(offshore, { wave, wind, linked: [{ spot: reciprocal, wave, wind }] }, at));
  assert.notEqual(forecastAlertKey(offshore, [coast]), forecastAlertKey(offshore, [{ ...coast,
    criteria: { ...coast.criteria, maxWindSpeed: 1 } }]));
  assert.notEqual(forecastAlertKey(offshore, [coast]), forecastAlertKey(offshore, []));
});

test("single-source points do not require or download unused marine/wind data", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url);
    const marine = url.hostname.startsWith("marine-");
    return Response.json({ timezone: "UTC", hourly: { time, ...(marine
      ? { swell_wave_height: wave.first, swell_wave_period: wave.second, swell_wave_direction: wave.third }
      : { wind_speed_10m: wind.first, wind_direction_10m: time.map(() => 355) }) } });
  };
  const coastOnly = await loadForecastGroup(coast, [], fetcher);
  assert.ok(coastOnly.ok);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].hostname, "api.open-meteo.com");
  assert.equal(scoreForecastData(coast, coastOnly.data, at)?.availableDays, 14);
  requests.length = 0;
  const result = await loadForecastGroup(offshore, [coast], fetcher);
  assert.ok(result.ok);
  assert.equal(requests.length, 2, "one swell point and one wind point require two provider calls");
  assert.equal(scoreForecastData(offshore, result.data, at)?.matchingDays, 14);
});

test("linked points use the longest hourly requirement and shortest look-ahead", () => {
  const longer = { ...coast, alertLookAheadDays: 7, criteria: { ...coast.criteria, minConsecutiveHours: 3 } };
  const result = scoreForecastData(offshore, { wave, wind, linked: [{ spot: longer, wave,
    wind: { ...wind, second: time.map(() => 355) } }] }, at)!;
  assert.equal(result.requiredHours, 3);
  assert.equal(result.horizonDays, 7);
  assert.equal(result.matchingDays, 7);
});

test("14-day alerts require consecutive matching hours on each local day", () => {
  const summary = scoreForecastAlert(spot, wave, wind, new Date("2026-09-27T00:00:00Z"));
  assert.ok(summary);
  assert.equal(summary.horizonDays, 14);
  assert.equal(summary.availableDays, 14);
  assert.equal(summary.requiredHours, 2);
  assert.equal(summary.matchingDays, 2);
  assert.equal(summary.nextWindowStart, time[30]);
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

test("forecast alerts reject swell periods above the saved maximum", () => {
  const capped = { ...spot, criteria: { ...spot.criteria, maxSwellPeriod: 12 } };
  const now = new Date("2026-09-27T00:00:00Z");
  assert.equal(scoreForecastAlert(capped, wave, wind, now)?.matchingDays, 2);
  const longer = { ...wave, second: time.map(() => 12.5) };
  assert.equal(scoreForecastAlert(capped, longer, wind, now)?.matchingDays, 0);
  assert.equal(scoreForecastAlert(spot, longer, wind, now)?.matchingDays, 2);
});

test("only 06:00–18:00 at the spot counts; windows end at 18:00 and never bridge missing hours", () => {
  const allGood = { ...wind, second: time.map(() => 355) };
  const at = new Date("2026-09-27T00:00:00Z");
  const utc = scoreForecastAlert(spot, wave, allGood, at)!;
  assert.equal(utc.windows[0].start, time[6]);
  assert.equal(utc.windows[0].end, time[18]);
  const taiwan = scoreForecastAlert(spot, { ...wave, timezone: "Asia/Taipei" }, allGood, at)!;
  assert.equal(taiwan.windows[0].start, time[0]); // already 08:00 at the spot
  assert.equal(taiwan.windows[0].end, time[10]); // 18:00 local
  const nights = { ...wind, second: time.map((_, index) => index % 24 < 6 || index % 24 >= 18 ? 355 : 180) };
  assert.equal(scoreForecastAlert(spot, wave, nights, at)?.matchingDays, 0);
  const gaps = { ...wind, second: time.map((_, index) => [6, 8].includes(index % 24) ? 355 : 180) };
  assert.equal(scoreForecastAlert(spot, wave, gaps, at)?.matchingDays, 0);
});


test("draft forecasts and batched saved alerts share downloads and scoring", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const marine = url.hostname.startsWith("marine-");
    const row = { timezone: "UTC", hourly: { time, ...(marine
      ? { swell_wave_height: wave.first, swell_wave_period: wave.second, swell_wave_direction: wave.third }
      : { wind_speed_10m: wind.first, wind_direction_10m: wind.second }) } };
    const count = url.searchParams.get("latitude")!.split(",").length;
    return Response.json(count > 1 ? Array.from({ length: count }, () => row) : row);
  };
  const result = await loadForecastPoint(spot.point, fetcher);
  assert.equal(requests.length, 2);
  assert.ok(result.ok);
  const now = new Date("2026-09-27T00:00:00Z");
  const draft = scoreForecastAlert({ criteria: spot.criteria }, result.data.wave, result.data.wind, now);
  const alerts = await loadForecastAlerts([spot, { ...spot, id: "second" }], now, fetcher);
  assert.equal(requests.length, 4, "saved checks retain multi-location batching");
  for (const check of alerts) { assert.ok(check.ok); assert.deepEqual(check.summary, draft); }
  for (const url of requests) {
    const marine = url.hostname.startsWith("marine-");
    assert.equal(url.searchParams.get("models"), marine ? "meteofrance_wave" : "ecmwf_ifs");
    assert.equal(url.searchParams.get("forecast_days"), marine ? "10" : "15");
    assert.equal(url.searchParams.get("cell_selection"), "sea");
    assert.equal(url.searchParams.get("timeformat"), "unixtime");
    assert.equal(url.searchParams.get("timezone"), "auto");
    if (!marine) assert.equal(url.searchParams.get("wind_speed_unit"), "ms");
  }
});

test("MFWAM's shorter coverage leaves later days unknown without extending swell or losing hourly wind", () => {
  const shortWave = { ...wave, time: time.slice(0, 240), first: wave.first.slice(0, 240),
    second: wave.second.slice(0, 240), third: wave.third.slice(0, 240) };
  const hourlyWind = { ...wind, second: time.map(() => 355) };
  const now = new Date("2026-09-27T00:00:00Z");
  const summary = scoreForecastAlert(spot, shortWave, hourlyWind, now)!;
  assert.equal(summary.horizonDays, 14);
  assert.equal(summary.availableDays, 10);
  assert.equal(summary.matchingDays, 10);
  assert.equal(summary.availableDates?.at(-1), "2026-10-06");
  assert.equal(summary.windows.at(-1)?.day, "2026-10-06");
  assert.equal(evaluateForecastRules(summary, [{ minDays: 11, withinDays: 14 }]).matched, false);
  assert.equal(evaluateForecastRules(summary, [{ minDays: 4, withinDays: 7 }]).matched, true);
  const missingTail = { ...shortWave, time, first: time.map((_, i) => shortWave.first[i] ?? null),
    second: time.map((_, i) => shortWave.second[i] ?? null), third: time.map((_, i) => shortWave.third[i] ?? null) };
  assert.deepEqual(scoreForecastAlert(spot, missingTail, hourlyWind, now), summary);
  const gusty = { ...hourlyWind, second: time.map((_, i) => i % 24 === 7 ? 180 : 355) };
  const threeHours = { ...spot, criteria: { ...spot.criteria, minConsecutiveHours: 3 } };
  const withHourlyWind = scoreForecastAlert(threeHours, shortWave, gusty, now)!;
  assert.equal(withHourlyWind.windows[0].start, time[8], "the 07:00 wind change interrupts a matching run");
});

test("draft forecasts report network and malformed-data failures", async () => {
  const unavailable: typeof fetch = async () => new Response("", { status: 503 });
  assert.deepEqual(await loadForecastPoint(spot.point, unavailable), { ok: false, error: { kind: "network" } });
  const invalid: typeof fetch = async () => Response.json({ timezone: "not-a-timezone", hourly: {
    time, swell_wave_height: wave.first, swell_wave_period: wave.second, swell_wave_direction: wave.third,
    wind_speed_10m: wind.first, wind_direction_10m: wind.second,
  } });
  assert.deepEqual(await loadForecastPoint(spot.point, invalid), { ok: false, error: { kind: "invalid" } });
});


const forecastForDays = (offsets: number[], horizonDays = 14): ForecastAlertSummary => {
  const at = Date.parse("2026-10-23T00:00:00Z");
  const dates = Array.from({ length: 14 }, (_, offset) => new Date(at + offset * 86_400_000).toISOString().slice(0, 10));
  return { windows: offsets.map((offset) => ({ day: dates[offset], start: at / 1000 + offset * 86_400 + 21_600, end: at / 1000 + offset * 86_400 + 28_800 })),
    matchingDays: offsets.length, availableDays: horizonDays, availableDates: dates.slice(0, horizonDays), horizonDays,
    requiredHours: 2, nextWindowStart: null, timezone: "UTC", checkedAt: at };
};

test("screenshot regression: later matching days satisfy sliding 4-day and 7-day rules", () => {
  const summary = forecastForDays([7, 10, 12, 13]); // Oct 30, Nov 2, Nov 4, Nov 5
  const rules = [{ minDays: 2, withinDays: 4 }, { minDays: 4, withinDays: 7 }];
  const result = evaluateForecastRules(summary, rules);
  assert.equal(result.matched, true);
  assert.deepEqual(result.rules.map((rule) => rule.met), [true, true]);
  assert.equal(result.rules[0].matchingDays, 3);
  assert.equal(result.rules[0].bestPeriod?.startDay, "2026-11-02");
  assert.equal(result.rules[1].matchingDays, 4);
  assert.equal(result.rules[1].bestPeriod?.startDay, "2026-10-30");
  assert.equal(result.rules[1].bestPeriod?.endDay, "2026-11-05");
  assert.deepEqual(result.windows.map((window) => window.day), summary.windows.map((window) => window.day));
  assert.equal(evaluateForecastRules({ ...summary, horizonDays: 7 }, rules).matched, false, "shorter look-ahead excludes later matches");
});

test("any sliding rule can trigger; widely spaced days do not become a qualifying period", () => {
  const rules = [{ minDays: 3, withinDays: 4 }, { minDays: 4, withinDays: 7 }];
  assert.deepEqual(evaluateForecastRules(forecastForDays([0, 1, 2]), rules).rules.map((rule) => rule.met), [true, false]);
  assert.deepEqual(evaluateForecastRules(forecastForDays([7, 9, 11, 13]), rules).rules.map((rule) => rule.met), [false, true]);
  assert.equal(evaluateForecastRules(forecastForDays([0, 4, 8, 12]), [{ minDays: 2, withinDays: 4 }, { minDays: 4, withinDays: 7 }]).matched, false);
});

test("sliding periods must fit wholly inside the look-ahead and include their end date", () => {
  const rules = [{ minDays: 2, withinDays: 4 }];
  const final = evaluateForecastRules(forecastForDays([10, 13]), rules);
  assert.equal(final.rules[0].matchingPeriods.length, 1);
  assert.equal(final.rules[0].bestPeriod?.endDay, "2026-11-05");
  assert.equal(evaluateForecastRules(forecastForDays([0, 4]), rules).matched, false, "five calendar days do not count as four");
  assert.deepEqual(evaluateForecastRules(forecastForDays([0, 10, 13]), rules).windows.map((window) => window.day),
    ["2026-11-02", "2026-11-05"], "unrelated single days are excluded from alert dates and the next qualifying window");
  assert.equal(evaluateForecastRules(forecastForDays([6, 7], 7), rules).matched, false, "day eight is outside a seven-day look-ahead");
  const tooLong = evaluateForecastRules(forecastForDays([1], 4), [{ minDays: 1, withinDays: 7 }]);
  assert.equal(tooLong.matched, false);
  assert.equal(tooLong.rules[0].bestPeriod, null);
  const partial = evaluateForecastRules({ ...forecastForDays([12]), availableDates: ["2026-11-04"], availableDays: 1 }, rules);
  assert.equal(partial.rules[0].availableDays, 1);
  assert.equal(partial.matched, false);
});

test("alert periods start on the forecast's local date, including across a month boundary", () => {
  const summary: ForecastAlertSummary = {
    windows: ["2026-10-31", "2026-11-01", "2026-11-04", "2026-11-05"].map((day) => ({ day,
      start: Date.parse(`${day}T00:00:00Z`) / 1000, end: Date.parse(`${day}T02:00:00Z`) / 1000 })),
    matchingDays: 4, availableDays: 14, horizonDays: 14, requiredHours: 2, nextWindowStart: null,
    timezone: "Asia/Taipei", checkedAt: Date.parse("2026-10-31T17:00:00Z"),
  };
  const result = evaluateForecastRules(summary, [{ minDays: 2, withinDays: 4 }]);
  assert.deepEqual(result.windows.map((window) => window.day), ["2026-11-01", "2026-11-04", "2026-11-05"]);
  assert.equal(result.rules[0].availableDays, null, "older stored summaries have unknown per-period coverage");
});

test("alert identity includes every period rule and treats legacy single thresholds equivalently", () => {
  assert.equal(forecastAlertKey(spot), forecastAlertKey({ ...spot, alertRules: [{ minDays: spot.alertMinDays, withinDays: 14 }] }));
  assert.notEqual(forecastAlertKey(spot), forecastAlertKey({ ...spot, alertRules: [{ minDays: 2, withinDays: 4 }] }));
  assert.equal(forecastAlertKey(spot), forecastAlertKey({ ...spot, alertLookAheadDays: 14 }));
  assert.notEqual(forecastAlertKey(spot), forecastAlertKey({ ...spot, alertLookAheadDays: 7 }));
});


test("look-ahead changes score the cached hours without changing the conditions or sliding rule", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  const short = scoreForecastAlert({ ...spot, alertLookAheadDays: 3 }, wave, wind, now)!;
  assert.equal(short.horizonDays, 3);
  assert.equal(short.availableDates?.length, 3);
  assert.equal(short.matchingDays, 1);
  assert.equal(scoreForecastAlert(spot, wave, wind, now)?.matchingDays, 2);
  assert.equal(evaluateForecastRules(short, [{ minDays: 2, withinDays: 3 }]).matched, false);
});

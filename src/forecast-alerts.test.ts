import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateForecastRules, forecastAlertKey, loadForecastPoint, loadForecastAlerts, scoreForecastAlert, type ForecastAlertSummary } from "./forecast-alerts.ts";
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
  assert.ok(requests.every((url) => url.searchParams.get("forecast_days") === "15"));
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


test("each alert row counts only its own next N days and any row can trigger", () => {
  const at = Date.parse("2026-10-23T00:00:00Z");
  const dates = Array.from({ length: 14 }, (_, offset) => new Date(at + offset * 86_400_000).toISOString().slice(0, 10));
  const forecast = (offsets: number[]): ForecastAlertSummary => ({
    windows: offsets.map((offset) => ({ day: dates[offset], start: at / 1000 + offset * 86_400 + 21_600, end: at / 1000 + offset * 86_400 + 28_800 })),
    matchingDays: offsets.length, availableDays: 14, availableDates: dates, horizonDays: 14,
    requiredHours: 2, nextWindowStart: null, timezone: "UTC", checkedAt: at,
  });
  const rules = [{ minDays: 2, withinDays: 4 }, { minDays: 4, withinDays: 7 }];
  const sevenOnly = evaluateForecastRules(forecast([1, 4, 5, 6]), rules);
  assert.deepEqual(sevenOnly.rules.map((rule) => rule.met), [false, true]);
  assert.equal(sevenOnly.matched, true);
  const fourOnly = evaluateForecastRules(forecast([1, 2, 8, 9]), rules);
  assert.deepEqual(fourOnly.rules.map((rule) => rule.met), [true, false]);
  assert.equal(fourOnly.matched, true);
  assert.deepEqual(fourOnly.windows.map((window) => window.day), [dates[1], dates[2]], "notifications include only windows from satisfied rules");
  assert.equal(evaluateForecastRules(forecast([1, 4, 8, 9]), rules).matched, false, "four good days across 14 do not satisfy either shorter rule");
  const boundary = evaluateForecastRules(forecast([0, 3, 4]), [{ minDays: 2, withinDays: 4 }]);
  assert.equal(boundary.rules[0].matchingDays, 2, "today and day four count; day five does not");
  const partial = evaluateForecastRules({ ...forecast([1]), availableDates: [dates[1]], availableDays: 1 }, rules);
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
  assert.deepEqual(result.windows.map((window) => window.day), ["2026-11-01", "2026-11-04"]);
  assert.equal(result.rules[0].availableDays, null, "older stored summaries have unknown per-period coverage");
});

test("alert identity includes every period rule and treats legacy single thresholds equivalently", () => {
  assert.equal(forecastAlertKey(spot), forecastAlertKey({ ...spot, alertRules: [{ minDays: spot.alertMinDays, withinDays: 14 }] }));
  assert.notEqual(forecastAlertKey(spot), forecastAlertKey({ ...spot, alertRules: [{ minDays: 2, withinDays: 4 }] }));
});

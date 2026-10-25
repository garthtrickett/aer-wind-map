import assert from "node:assert/strict";
import test from "node:test";
import { compassReadingAt, loadCompassForecast } from "./compass-forecast.ts";
import { defaultHistoryCriteria } from "./history.ts";
import { initialState, present } from "./model.ts";
import { clockwiseWedgePath } from "./history-compass-geometry.ts";

const time = Date.parse("2026-10-25T06:00:00Z") / 1000;
const criteria = { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45, swellFromStart: 180, swellFromEnd: 270 };
const point = { latitude: -8.7, longitude: 115.27 };
const data = {
  wind: { timezone: "Asia/Makassar", time: [time], first: [3], second: [355], third: null },
  swell: { timezone: "Asia/Makassar", time: [time], first: [1.8], second: [14], third: [225] },
};

test("compass uses meteorological from-bearings and the requested hour, with m/s converted to km/h", () => {
  const reading = compassReadingAt(data, time + 3599, criteria)!;
  assert.equal(reading.time, time);
  assert.equal(reading.wind?.direction, 355);
  assert.equal(reading.wind?.fits, true);
  assert.ok(Math.abs(reading.wind!.speedKmh! - 10.8) < 1e-9);
  assert.equal(reading.swell?.direction, 225);
  assert.equal(reading.swell?.fits, true);
  assert.equal(compassReadingAt(data, time, { ...criteria, swellFromStart: 0, swellFromEnd: 90 })?.swell?.fits, false);
  assert.equal(compassReadingAt(data, time + 3600, criteria)?.wind, null);
  assert.equal(compassReadingAt(data, null, criteria), null);
});

test("missing, invalid and flat directions never become a misleading north ray; calm wind is marked separately", () => {
  for (const value of [null, NaN, 999]) {
    const reading = compassReadingAt({ ...data, wind: { ...data.wind, second: [value] }, swell: { ...data.swell, third: [value] } }, time, criteria)!;
    assert.equal(reading.wind?.direction, null); assert.equal(reading.swell?.direction, null);
  }
  const zero = compassReadingAt({ wind: { ...data.wind, first: [0] }, swell: { ...data.swell, first: [0] } }, time, criteria)!;
  assert.equal(zero.wind?.direction, null); assert.equal(zero.wind?.calm, true); assert.equal(zero.swell?.direction, null);
  const calm = compassReadingAt({ ...data, wind: { ...data.wind, first: [.5], second: [180] } }, time, criteria)!;
  assert.equal(calm.wind?.fits, false); assert.equal(calm.wind?.calm, true);
  assert.equal(compassReadingAt({ ...data, wind: { ...data.wind, first: [.5], second: [180] } }, time, { ...criteria, calmWindKmh: 0 })?.wind?.calm, false);
  assert.equal(compassReadingAt({ ...data, wind: { ...data.wind, second: [360] } }, time, criteria)?.wind?.direction, 0);
});

test("compass independently preserves wind when swell fails, and wind-only markers make no marine request", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes("marine-api")) return new Response("Unavailable", { status: 503 });
    return Response.json({ timezone: "Asia/Makassar", hourly: { time: [time], wind_speed_10m: [3], wind_direction_10m: [355] } });
  };
  const result = await loadCompassForecast(point, "both", new AbortController().signal, fetcher);
  assert.ok(result.ok); assert.ok(result.data.wind); assert.equal(result.data.swell, null);
  calls.length = 0;
  assert.ok((await loadCompassForecast(point, "wind", new AbortController().signal, fetcher)).ok);
  assert.equal(calls.length, 1); assert.ok(!calls[0].includes("marine-api"));
});

test("compass requests are cancelled through the source API", async () => {
  const controller = new AbortController(); let aborted = false;
  const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("Aborted")); });
  });
  const pending = loadCompassForecast(point, "wind", controller.signal, fetcher);
  controller.abort(); assert.equal((await pending).ok, false); assert.equal(aborted, true);
});

test("compass follows the marker and marker type, discards stale replies, and range/time edits do not refetch", () => {
  let state = present(present(initialState, { kind: "locationSelected", point }), { kind: "historyOpened" });
  const request = state.compassForecast.request;
  state = present(state, { kind: "compassForecastStarted", request });
  state = present(state, { kind: "compassForecastCompleted", request, result: { ok: true, data }, checkedAt: time * 1000 });
  assert.equal(state.compassForecast.mode, "now");
  state = present(state, { kind: "compassTimeModeChanged", mode: "map" });
  state = present(state, { kind: "historyCriteriaChanged", criteria });
  assert.equal(state.compassForecast.request, request); assert.equal(state.compassForecast.data, data);
  state = present(state, { kind: "historyCriteriaChanged", criteria: { ...criteria, conditions: "wind" } });
  assert.equal(state.compassForecast.phase, "needsData"); assert.equal(state.compassForecast.data, null);
  state = present(state, { kind: "compassForecastCompleted", request, result: { ok: true, data }, checkedAt: time * 1000 });
  assert.equal(state.compassForecast.data, null);
  state = present(state, { kind: "historyClosed" });
  assert.equal(state.compassForecast.phase, "idle");
});

test("compass clock refreshes stale point forecasts, and solid wedges handle north-crossing/full/empty ranges", () => {
  let state = present(present(initialState, { kind: "locationSelected", point }), { kind: "historyOpened" });
  const request = state.compassForecast.request;
  state = present(state, { kind: "compassForecastStarted", request });
  state = present(state, { kind: "compassForecastCompleted", request, result: { ok: true, data }, checkedAt: time * 1000 });
  state = present(state, { kind: "compassClockTick", now: time * 1000 + 16 * 60_000 });
  assert.equal(state.compassForecast.phase, "needsData");
  assert.equal(state.compassForecast.nowHour, time);
  assert.match(clockwiseWedgePath(315, 45, 130), /A 130 130 0 0 1/);
  assert.equal((clockwiseWedgePath(0, 360, 130).match(/A 130/g) ?? []).length, 2);
  assert.equal(clockwiseWedgePath(50, 50, 130), "");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHistoryCriteria, directionInClockwiseRange, historyCsv, hourMatchesCriteria, loadHistoricalSpot, summarizeHistory, type HistoricalData, type HistoricalHour } from "./history.ts";

const hoursFor = (date: string, matching: readonly number[], direction = 355, available = 24): HistoricalHour[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    time: Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`) / 1000,
    day: date,
    swellHeight: hour < available ? matching.includes(hour) ? 2 : 0.5 : null,
    swellPeriod: hour < available ? 12 : null,
    swellDirection: hour < available ? 220 : null,
    windSpeed: hour < available ? 3 : null,
    windDirection: hour < available ? direction : null,
  }));

test("swell period bounds are inclusive and an over-limit hour breaks the matching window", () => {
  const criteria = { ...defaultHistoryCriteria, minSwellPeriod: 8, maxSwellPeriod: 12,
    windFromStart: 0, windFromEnd: 360 };
  const hour = hoursFor("2025-01-01", [10])[10]!;
  for (const [period, expected] of [[7.5, false], [8, true], [12, true], [12.5, false]] as const) {
    assert.equal(hourMatchesCriteria({ ...hour, swellPeriod: period }, criteria), expected);
  }
  assert.equal(hourMatchesCriteria({ ...hour, swellPeriod: 35 }, { ...criteria, maxSwellPeriod: null }), true);
  assert.equal(hourMatchesCriteria({ ...hour, swellPeriod: null }, criteria), false);
  const data: HistoricalData = {
    startYear: 2025, endYear: 2025, timezone: "UTC",
    waveGrid: { latitude: 0, longitude: 0 }, windGrid: { latitude: 0, longitude: 0 },
    hours: hoursFor("2025-01-01", [10, 11, 12])
      .map((value, index) => index === 11 ? { ...value, swellPeriod: 13 } : value),
  };
  const capped = summarizeHistory(data, criteria);
  assert.equal(capped.days[0]?.longestWindow, 1);
  assert.equal(capped.months[0]?.qualifyingDays, 0);
  assert.equal(capped.months[0]?.observedDays, 1);
  assert.equal(summarizeHistory(data, { ...criteria, maxSwellPeriod: null }).days[0]?.longestWindow, 3);
  assert.ok(historyCsv(data, criteria).includes("2025-01-01T11:00:00.000Z,2025-01-01,2,13,220,3,355,0"));
});

test("monthly score requires consecutive matching hours and enough paired data", () => {
  const data: HistoricalData = {
    startYear: 2025, endYear: 2025, timezone: "UTC",
    waveGrid: { latitude: 0, longitude: 0 }, windGrid: { latitude: 0, longitude: 0 },
    hours: [
      ...hoursFor("2025-01-01", [10, 11]),
      ...hoursFor("2025-01-02", [10, 12]),
      ...hoursFor("2025-01-03", [10, 11], 355, 17),
      ...hoursFor("2025-02-01", [10, 11], 180),
    ],
  };
  const criteria = { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45,
    swellFromStart: 180, swellFromEnd: 270 };
  const summary = summarizeHistory(data, criteria);
  assert.deepEqual(summary.months[0], { month: 0, qualifyingDays: 1, observedDays: 2, totalDays: 31, percent: 50 });
  assert.deepEqual(summary.months[1], { month: 1, qualifyingDays: 0, observedDays: 1, totalDays: 28, percent: 0 });
  assert.equal(summary.days.find((day) => day.day === "2025-01-01")?.longestWindow, 2);
  assert.equal(summary.days.find((day) => day.day === "2025-01-03")?.qualifies, false);
  assert.equal(summarizeHistory(data, { ...criteria, swellFromStart: 280, swellFromEnd: 20 }).months[0]?.qualifyingDays, 0);
  const csv = historyCsv(data, criteria);
  assert.ok(csv.includes("2025-01-01T10:00:00.000Z,2025-01-01,2,12,220,3,355,1"));
});

test("clockwise bearing ranges cross north and can cover the long arc", () => {
  assert.equal(directionInClockwiseRange(350, 315, 45), true);
  assert.equal(directionInClockwiseRange(20, 315, 45), true);
  assert.equal(directionInClockwiseRange(180, 315, 45), false);
  assert.equal(directionInClockwiseRange(180, 45, 315), true);
  assert.equal(directionInClockwiseRange(350, 45, 315), false);
  assert.equal(directionInClockwiseRange(359, 0, 360), true);
  assert.equal(directionInClockwiseRange(0, 90, 90), false);
  assert.equal(directionInClockwiseRange(90, 90, 90), true);
});

test("historical windows only count 06:00 through 17:00 and retain full-day coverage", () => {
  const data: HistoricalData = {
    startYear: 2025, endYear: 2025, timezone: "UTC",
    waveGrid: { latitude: 0, longitude: 0 }, windGrid: { latitude: 0, longitude: 0 },
    hours: [
      ...hoursFor("2025-01-01", [0, 1, 2]),
      ...hoursFor("2025-01-02", [5, 6]),
      ...hoursFor("2025-01-03", [6, 7]),
      ...hoursFor("2025-01-04", [16, 17]),
      ...hoursFor("2025-01-05", [17, 18]),
      ...hoursFor("2025-01-06", [6, 7, 18, 19, 20, 21]),
      ...hoursFor("2025-01-07", Array.from({ length: 24 }, (_, hour) => hour)),
    ],
  };
  const criteria = { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45 };
  const summary = summarizeHistory(data, criteria);
  assert.deepEqual(summary.days.slice(0, 7).map((day) => day.qualifies), [false, false, true, true, false, true, true]);
  assert.deepEqual(summary.days.slice(0, 7).map((day) => day.longestWindow), [0, 1, 2, 2, 1, 2, 12]);
  assert.equal(summary.days[5]?.windowStart, Date.parse("2025-01-06T06:00:00Z") / 1000);
  assert.equal(summary.days[6]?.availableHours, 24);
  assert.equal(summary.months[0]?.observedDays, 7);
});

test("history scores and CSV match flags use the spot's timezone across UTC day boundaries", () => {
  const criteria = { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45 };
  for (const [timezone, offset] of [["Asia/Makassar", 8], ["Pacific/Honolulu", -10]] as const) {
    const data: HistoricalData = {
      startYear: 2025, endYear: 2025, timezone,
      waveGrid: { latitude: 0, longitude: 0 }, windGrid: { latitude: 0, longitude: 0 },
      hours: hoursFor("2025-01-01", Array.from({ length: 24 }, (_, hour) => hour))
        .map((hour) => ({ ...hour, time: hour.time - offset * 3600 })),
    };
    const summary = summarizeHistory(data, criteria);
    assert.equal(summary.days[0]?.qualifies, true, timezone);
    assert.equal(summary.days[0]?.longestWindow, 12, timezone);
    assert.equal(summary.days[0]?.windowStart, Date.parse("2025-01-01T06:00:00Z") / 1000 - offset * 3600, timezone);
    const csvRows = historyCsv(data, criteria).trim().split("\n").slice(1).map((row) => row.split(","));
    assert.equal(csvRows.length, 24);
    assert.deepEqual(csvRows.map((row) => row[7]), [
      ...Array(6).fill("0"), ...Array(12).fill("1"), ...Array(6).fill("0"),
    ], timezone);
  }
});

test("historical fetch joins marine and wind by instant and uses the spot time zone", async () => {
  const first = Date.parse("2025-06-01T00:00:00Z") / 1000;
  const urls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const marine = url.includes("marine-api");
    return new Response(JSON.stringify(marine ? {
      latitude: -8.875, longitude: 115.125, timezone: "Asia/Makassar",
      hourly: { time: [first, first + 3600], swell_wave_height: [1.8, 2], swell_wave_period: [12, 13], swell_wave_direction: [220, 225] },
    } : {
      latitude: -8.82, longitude: 115.08, timezone: "Asia/Makassar",
      hourly: { time: [first + 3600, first + 7200], wind_speed_10m: [4, 5], wind_direction_10m: [90, 100] },
    }));
  }) as typeof fetch;
  const result = await loadHistoricalSpot({ point: { latitude: -8.85, longitude: 115.1 }, startYear: 2025, endYear: 2025, fetcher });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.hours[0]?.day, "2025-06-01");
  assert.equal(result.value.hours[0]?.windSpeed, null);
  assert.equal(result.value.hours[1]?.windSpeed, 4);
  assert.equal(result.value.hours[1]?.swellDirection, 225);
  assert.equal(result.value.waveGrid.latitude, -8.875);
  assert.ok(urls.some((url) => url.includes("models=meteofrance_wave") && url.includes("cell_selection=sea") && url.includes("swell_wave_direction")));
  assert.ok(urls.some((url) => url.includes("models=ecmwf_ifs") && url.includes("wind_speed_unit=ms")));
});

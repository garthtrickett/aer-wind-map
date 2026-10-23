import type { Point } from "./model.ts";

export type HistoryCriteria = Readonly<{
  minSwellHeight: number;
  maxSwellHeight: number;
  minSwellPeriod: number;
  maxSwellPeriod: number | null;
  maxWindSpeed: number;
  windFromStart: number;
  windFromEnd: number;
  swellFromStart: number;
  swellFromEnd: number;
  minConsecutiveHours: number;
}>;

export const defaultHistoryCriteria: HistoryCriteria = {
  minSwellHeight: 1,
  maxSwellHeight: 3,
  minSwellPeriod: 10,
  maxSwellPeriod: null,
  maxWindSpeed: 5,
  windFromStart: 45,
  windFromEnd: 135,
  swellFromStart: 0,
  swellFromEnd: 360,
  minConsecutiveHours: 2,
};

export type HistoricalHour = Readonly<{
  time: number;
  day: string;
  swellHeight: number | null;
  swellPeriod: number | null;
  swellDirection: number | null;
  windSpeed: number | null;
  windDirection: number | null;
}>;

export type HistoricalData = Readonly<{
  startYear: number;
  endYear: number;
  timezone: string;
  waveGrid: Point;
  windGrid: Point;
  hours: readonly HistoricalHour[];
}>;

export type HistoryError = Readonly<{ kind: "network" | "unavailable" | "invalid"; detail: string }>;
export type HistoryResult =
  | Readonly<{ ok: true; value: HistoricalData }>
  | Readonly<{ ok: false; error: HistoryError }>;

type Series = Readonly<{
  latitude: number;
  longitude: number;
  timezone: string;
  time: readonly number[];
  first: readonly (number | null)[];
  second: readonly (number | null)[];
  third: readonly (number | null)[] | null;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

const parseSeries = (raw: unknown, firstName: string, secondName: string, thirdName?: string): Series | null => {
  if (!isRecord(raw) || !isRecord(raw.hourly)) return null;
  const hourly = raw.hourly;
  const time = hourly.time;
  const first = hourly[firstName];
  const second = hourly[secondName];
  const third = thirdName ? hourly[thirdName] : null;
  if (typeof raw.latitude !== "number" || !Number.isFinite(raw.latitude) ||
    typeof raw.longitude !== "number" || !Number.isFinite(raw.longitude) ||
    typeof raw.timezone !== "string" || !Array.isArray(time) || !Array.isArray(first) || !Array.isArray(second) ||
    !time.length || time.length !== first.length || time.length !== second.length ||
    !time.every((value) => Number.isInteger(value)) ||
    !first.every(isNumberOrNull) || !second.every(isNumberOrNull) ||
    (thirdName && (!Array.isArray(third) || third.length !== time.length || !third.every(isNumberOrNull)))) return null;
  return {
    latitude: raw.latitude, longitude: raw.longitude, timezone: raw.timezone,
    time: time as number[], first: first as (number | null)[], second: second as (number | null)[],
    third: thirdName ? third as (number | null)[] : null,
  };
};

const historicalUrl = (base: string, point: Point, startYear: number, endYear: number, hourly: string, model: string): string => {
  const query = new URLSearchParams({
    latitude: String(point.latitude), longitude: String(point.longitude), hourly, models: model,
    start_date: `${startYear}-01-01`, end_date: `${endYear}-12-31`,
    timezone: "auto", timeformat: "unixtime", cell_selection: "sea",
  });
  if (model === "ecmwf_ifs") query.set("wind_speed_unit", "ms");
  return `${base}?${query}`;
};

const localDay = (time: number, formatter: Intl.DateTimeFormat): string => {
  const parts = formatter.formatToParts(new Date(time * 1000));
  const part = (kind: string): string => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const loadHistoricalSpot = async (
  { point, startYear, endYear, fetcher = fetch }: Readonly<{ point: Point; startYear: number; endYear: number; fetcher?: typeof fetch }>,
): Promise<HistoryResult> => {
  const waveUrl = historicalUrl("https://marine-api.open-meteo.com/v1/marine", point, startYear, endYear,
    "swell_wave_height,swell_wave_period,swell_wave_direction", "meteofrance_wave");
  const windUrl = historicalUrl("https://archive-api.open-meteo.com/v1/archive", point, startYear, endYear,
    "wind_speed_10m,wind_direction_10m", "ecmwf_ifs");
  let waveRaw: unknown;
  let windRaw: unknown;
  try {
    const [waveResponse, windResponse] = await Promise.all([
      fetcher(waveUrl, { signal: AbortSignal.timeout(45_000) }),
      fetcher(windUrl, { signal: AbortSignal.timeout(45_000) }),
    ]);
    if (!waveResponse.ok || !windResponse.ok) {
      return { ok: false, error: { kind: "unavailable", detail: `Wave HTTP ${waveResponse.status}; wind HTTP ${windResponse.status}` } };
    }
    [waveRaw, windRaw] = await Promise.all([waveResponse.json(), windResponse.json()]);
  } catch (cause) {
    return { ok: false, error: { kind: "network", detail: String(cause) } };
  }
  const wave = parseSeries(waveRaw, "swell_wave_height", "swell_wave_period", "swell_wave_direction");
  const wind = parseSeries(windRaw, "wind_speed_10m", "wind_direction_10m");
  if (!wave || !wind) return { ok: false, error: { kind: "invalid", detail: "Historical hourly data was incomplete." } };

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone: wave.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return { ok: false, error: { kind: "invalid", detail: "Historical location time zone was invalid." } };
  }
  const windAt = new Map(wind.time.map((time, index) => [time, index]));
  const hours = wave.time.map((time, index): HistoricalHour => {
    const windIndex = windAt.get(time);
    return {
      time, day: localDay(time, formatter),
      swellHeight: wave.first[index] ?? null, swellPeriod: wave.second[index] ?? null,
      swellDirection: wave.third?.[index] ?? null,
      windSpeed: windIndex === undefined ? null : wind.first[windIndex] ?? null,
      windDirection: windIndex === undefined ? null : wind.second[windIndex] ?? null,
    };
  });
  return { ok: true, value: {
    startYear, endYear, timezone: wave.timezone,
    waveGrid: { latitude: wave.latitude, longitude: wave.longitude },
    windGrid: { latitude: wind.latitude, longitude: wind.longitude },
    hours,
  } };
};

export type DailyHistory = Readonly<{
  day: string;
  month: number;
  availableHours: number;
  longestWindow: number;
  windowStart: number | null;
  qualifies: boolean;
}>;

export type MonthlyHistory = Readonly<{
  month: number;
  qualifyingDays: number;
  observedDays: number;
  totalDays: number;
  percent: number;
}>;

export type HistorySummary = Readonly<{ months: readonly MonthlyHistory[]; days: readonly DailyHistory[] }>;

export const directionInClockwiseRange = (actual: number, start: number, end: number): boolean => {
  const span = end >= start ? end - start : end - start + 360;
  const offset = ((actual - start) % 360 + 360) % 360;
  return span === 360 || offset <= span;
};

export const hourMatchesCriteria = (hour: HistoricalHour, criteria: HistoryCriteria): boolean =>
  hour.swellHeight !== null && hour.swellPeriod !== null && hour.swellDirection !== null &&
  hour.windSpeed !== null && hour.windDirection !== null &&
  hour.swellHeight >= criteria.minSwellHeight && hour.swellHeight <= criteria.maxSwellHeight &&
  hour.swellPeriod >= criteria.minSwellPeriod &&
  (criteria.maxSwellPeriod === null || hour.swellPeriod <= criteria.maxSwellPeriod) &&
  hour.windSpeed <= criteria.maxWindSpeed &&
  directionInClockwiseRange(hour.windDirection, criteria.windFromStart, criteria.windFromEnd) &&
  directionInClockwiseRange(hour.swellDirection, criteria.swellFromStart, criteria.swellFromEnd);

const historyClock = (timezone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" });

const withinHistoryHours = (time: number, clock: Intl.DateTimeFormat): boolean => {
  const hour = Number(clock.format(new Date(time * 1000)));
  return hour >= 6 && hour < 18;
};

export const historyCsv = (data: HistoricalData, criteria: HistoryCriteria): string => {
  const value = (number: number | null): string => number === null ? "" : String(number);
  const clock = historyClock(data.timezone);
  const lines = ["time_utc,local_day,swell_height_m,swell_period_s,swell_from_degrees,wind_speed_ms,wind_from_degrees,meets_conditions"];
  for (const hour of data.hours) {
    lines.push([
      new Date(hour.time * 1000).toISOString(), hour.day, value(hour.swellHeight), value(hour.swellPeriod),
      value(hour.swellDirection), value(hour.windSpeed), value(hour.windDirection),
      withinHistoryHours(hour.time, clock) && hourMatchesCriteria(hour, criteria) ? "1" : "0",
    ].join(","));
  }
  return `${lines.join("\n")}\n`;
};

export const summarizeHistory = (data: HistoricalData, criteria: HistoryCriteria): HistorySummary => {
  const clock = historyClock(data.timezone);
  const days = new Map<string, { available: number; longest: number; bestStart: number | null; run: number; runStart: number | null; lastTime: number | null }>();
  for (let year = data.startYear; year <= data.endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 1; day <= count; day++) {
        const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        days.set(key, { available: 0, longest: 0, bestStart: null, run: 0, runStart: null, lastTime: null });
      }
    }
  }
  for (const hour of data.hours) {
    const day = days.get(hour.day);
    if (!day) continue;
    const available = hour.swellHeight !== null && hour.swellPeriod !== null && hour.swellDirection !== null &&
      hour.windSpeed !== null && hour.windDirection !== null;
    if (available) day.available++;
    if (!withinHistoryHours(hour.time, clock) || !hourMatchesCriteria(hour, criteria)) {
      day.run = 0; day.runStart = null; day.lastTime = null; continue;
    }
    if (day.lastTime !== null && hour.time - day.lastTime === 3600) day.run++;
    else { day.run = 1; day.runStart = hour.time; }
    day.lastTime = hour.time;
    if (day.run > day.longest) { day.longest = day.run; day.bestStart = day.runStart; }
  }
  const daily = [...days].map(([day, value]): DailyHistory => {
    const observed = value.available >= 18;
    return {
      day, month: Number(day.slice(5, 7)) - 1, availableHours: value.available,
      longestWindow: value.longest, windowStart: value.bestStart,
      qualifies: observed && value.longest >= criteria.minConsecutiveHours,
    };
  });
  const months = Array.from({ length: 12 }, (_, month): MonthlyHistory => {
    const sameMonth = daily.filter((day) => day.month === month);
    const observedDays = sameMonth.filter((day) => day.availableHours >= 18).length;
    const qualifyingDays = sameMonth.filter((day) => day.qualifies).length;
    return {
      month, qualifyingDays, observedDays, totalDays: sameMonth.length,
      percent: observedDays ? 100 * qualifyingDays / observedDays : 0,
    };
  });
  return { months, days: daily };
};

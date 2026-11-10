import type { Point } from "./model.ts";

export type DayHour = Readonly<{
  time: number;
  windSpeed: number | null;
  windDirection: number | null;
  swellHeight: number | null;
  swellPeriod: number | null;
  swellDirection: number | null;
  seaLevel: number | null;
}>;
export type DaySource = Readonly<{ grid: Point | null; issue: string | null }>;
export type DayData = Readonly<{
  date: string;
  timezone: string;
  wind: DaySource;
  waves: DaySource;
  tide: DaySource;
  hours: readonly DayHour[];
}>;
export type DayResult = Readonly<{ ok: true; data: DayData }> | Readonly<{ ok: false; message: string }>;
export const firstLookupDate = "2022-01-01";
export const validLookupDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date >= firstLookupDate;

type Series = Readonly<{ timezone: string; grid: Point; time: readonly number[]; values: Readonly<Record<string, readonly (number | null)[]>> }>;
type SourceResult = Readonly<{ ok: true; series: Series }> | Readonly<{ ok: false; message: string }>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const windFields = ["wind_speed_10m", "wind_direction_10m"];
const waveFields = ["swell_wave_height", "swell_wave_period", "swell_wave_direction"];

const readSource = async (url: string, fields: readonly string[], fetcher: typeof fetch, signal: AbortSignal): Promise<SourceResult> => {
  try {
    const response = await fetcher(url, { signal });
    if (!response.ok) return { ok: false, message: `Source unavailable (HTTP ${response.status}). Try another date or retry.` };
    const data: unknown = await response.json();
    if (!record(data) || !number(data.latitude) || !number(data.longitude) || Math.abs(data.latitude) > 90 || Math.abs(data.longitude) > 180 ||
      typeof data.timezone !== "string" || !record(data.hourly)) throw new Error("Invalid hourly response");
    new Intl.DateTimeFormat("en", { timeZone: data.timezone }).format();
    const time = data.hourly.time;
    if (!Array.isArray(time) || time.length > 26 || !time.every(number) ||
      time.some((value, index) => index > 0 && value <= time[index - 1])) throw new Error("Invalid hourly times");
    const values: Record<string, readonly (number | null)[]> = {};
    for (const field of fields) {
      const series = data.hourly[field];
      if (!Array.isArray(series) || series.length !== time.length || !series.every((value) => value === null || number(value)))
        throw new Error("Incomplete hourly response");
      values[field] = series.map((value) => value === null || (field !== "sea_level_height_msl" && value < 0) ||
        (field.includes("direction") && value > 360) ? null : value);
    }
    return { ok: true, series: { timezone: data.timezone, grid: { latitude: data.latitude, longitude: data.longitude }, time, values } };
  } catch (cause) {
    return { ok: false, message: signal.aborted ? "Request timed out or was cancelled. Retry when ready."
      : cause instanceof TypeError ? "Could not reach the source. Check your connection and retry."
      : "The source did not return usable hourly data. Try another date or retry." };
  }
};

export const lookupLocalDate = (time: number, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(time * 1000));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const loadDay = async (point: Point, date: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<DayResult> => {
  if (!validLookupDate(date) || date > new Date().toISOString().slice(0, 10) || !number(point.latitude) || !number(point.longitude) ||
    Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return { ok: false, message: "Choose a valid past date from 2022 onward." };
  const common = { latitude: String(point.latitude), longitude: String(point.longitude), start_date: date, end_date: date,
    timezone: "auto", timeformat: "unixtime", cell_selection: "sea" };
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const [wind, waves, tide] = await Promise.all([
    readSource(`https://archive-api.open-meteo.com/v1/archive?${new URLSearchParams({ ...common,
      models: "ecmwf_ifs", hourly: windFields.join(","), wind_speed_unit: "kmh" })}`, windFields, fetcher, requestSignal),
    readSource(`https://marine-api.open-meteo.com/v1/marine?${new URLSearchParams({ ...common,
      models: "meteofrance_wave", hourly: waveFields.join(",") })}`, waveFields, fetcher, requestSignal),
    readSource(`https://marine-api.open-meteo.com/v1/marine?${new URLSearchParams({ ...common,
      models: "meteofrance_currents", hourly: "sea_level_height_msl" })}`, ["sea_level_height_msl"], fetcher, requestSignal),
  ]);
  if (!wind.ok && !waves.ok && !tide.ok) return { ok: false, message: `Wind: ${wind.message} Primary swell: ${waves.message} Tide: ${tide.message}` };
  const timezone = wind.ok ? wind.series.timezone : waves.ok ? waves.series.timezone : tide.ok ? tide.series.timezone : "UTC";
  const rows = (source: SourceResult) => new Map(source.ok ? source.series.time.map((time, index) => [time, index]) : []);
  const windRows = rows(wind), waveRows = rows(waves), tideRows = rows(tide);
  const value = (source: SourceResult, index: number | undefined, field: string): number | null =>
    source.ok && index !== undefined ? source.series.values[field][index] ?? null : null;
  const times = [...new Set([...windRows.keys(), ...waveRows.keys(), ...tideRows.keys()])].sort((a, b) => a - b)
    .filter((time) => lookupLocalDate(time, timezone) === date);
  const hours = times.map((time): DayHour => ({ time,
    windSpeed: value(wind, windRows.get(time), "wind_speed_10m"), windDirection: value(wind, windRows.get(time), "wind_direction_10m"),
    swellHeight: value(waves, waveRows.get(time), "swell_wave_height"), swellPeriod: value(waves, waveRows.get(time), "swell_wave_period"),
    swellDirection: value(waves, waveRows.get(time), "swell_wave_direction"),
    seaLevel: value(tide, tideRows.get(time), "sea_level_height_msl"),
  }));
  const source = (result: SourceResult): DaySource => result.ok ? { grid: result.series.grid, issue: null } : { grid: null, issue: result.message };
  const tideSource = source(tide);
  return { ok: true, data: { date, timezone, wind: source(wind), waves: source(waves),
    tide: tideSource.issue || hours.some((hour) => hour.seaLevel !== null) ? tideSource
      : { ...tideSource, issue: "No tide / sea-level estimates for this date and location." }, hours } };
};

/** Approximate slope from adjacent, contiguous hourly samples; never bridge a gap. */
export const seaLevelTrend = (data: DayData, time: number): "Rising" | "Falling" | "Steady" | null => {
  const index = data.hours.findIndex((hour) => hour.time === time);
  const current = data.hours[index];
  if (!current || current.seaLevel === null) return null;
  const previous = data.hours[index - 1], next = data.hours[index + 1];
  const before = previous && previous.time === time - 3600 ? previous.seaLevel : null;
  const after = next && next.time === time + 3600 ? next.seaLevel : null;
  if (before === null && after === null) return null;
  const change = (after ?? current.seaLevel) - (before ?? current.seaLevel);
  return change > .005 ? "Rising" : change < -.005 ? "Falling" : "Steady";
};

export const dayHours = (data: DayData, start: number, end: number): readonly DayHour[] => {
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, hour: "2-digit", hourCycle: "h23" });
  return data.hours.filter((row) => {
    const hour = Number(clock.format(new Date(row.time * 1000)));
    return hour >= start && hour < end;
  });
};

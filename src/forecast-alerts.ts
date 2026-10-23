import { historyClock, withinHistoryHours, hourMatchesCriteria, type HistoricalHour } from "./history.ts";
import type { SavedSpot } from "./saved-spots.ts";

export const forecastAlertDays = 14;
export type ForecastWindow = Readonly<{ day: string; start: number; end: number }>;
export type ForecastAlertSummary = Readonly<{
  windows: readonly ForecastWindow[];
  matchingDays: number;
  availableDays: number;
  horizonDays: number;
  requiredHours: number;
  nextWindowStart: number | null;
  timezone: string;
  checkedAt: number;
}>;
export type ForecastAlertError = Readonly<{ kind: "network" | "invalid" | "unavailable" }>;
export type ForecastAlertCheck =
  | Readonly<{ id: string; key: string; ok: true; summary: ForecastAlertSummary }>
  | Readonly<{ id: string; key: string; ok: false; error: ForecastAlertError }>;

type ForecastSeries = Readonly<{
  timezone: string;
  time: readonly number[];
  first: readonly (number | null)[];
  second: readonly (number | null)[];
  third: readonly (number | null)[] | null;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numberOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

const parseSeries = (raw: unknown, fields: readonly [string, string, string?]): ForecastSeries | null => {
  if (!isRecord(raw) || !isRecord(raw.hourly) || typeof raw.timezone !== "string") return null;
  const [firstName, secondName, thirdName] = fields;
  const { time } = raw.hourly;
  const first = raw.hourly[firstName];
  const second = raw.hourly[secondName];
  const third = thirdName ? raw.hourly[thirdName] : null;
  if (!Array.isArray(time) || !Array.isArray(first) || !Array.isArray(second) ||
    (thirdName && !Array.isArray(third)) || time.length === 0 || first.length !== time.length || second.length !== time.length ||
    (thirdName && (third as unknown[]).length !== time.length) ||
    !time.every((value, index) => Number.isInteger(value) && (index === 0 || value > time[index - 1])) ||
    !first.every(numberOrNull) || !second.every(numberOrNull) || (thirdName && !(third as unknown[]).every(numberOrNull))) return null;
  return { timezone: raw.timezone, time: time as number[], first: first as (number | null)[],
    second: second as (number | null)[], third: third as (number | null)[] | null };
};

const localDayFormatter = (timezone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });

const dayAt = (time: number, formatter: Intl.DateTimeFormat): string => {
  const parts = formatter.formatToParts(new Date(time * 1000));
  const part = (kind: string): string => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const forecastAlertKey = (spot: SavedSpot): string =>
  JSON.stringify([spot.id, spot.point, spot.criteria, spot.alertEnabled, spot.alertMinDays]);

export const scoreForecastAlert = (
  spot: SavedSpot, wave: ForecastSeries, wind: ForecastSeries, now: Date,
): ForecastAlertSummary | null => {
  const formatter = localDayFormatter(wave.timezone);
  const clock = historyClock(wave.timezone);
  const today = dayAt(now.getTime() / 1000, formatter);
  const firstDay = Date.parse(`${today}T00:00:00Z`);
  const dates = Array.from({ length: forecastAlertDays }, (_, index) =>
    new Date(firstDay + index * 86_400_000).toISOString().slice(0, 10));
  const days = new Map(dates.map((date) => [date, { available: 0, run: 0, lastTime: null as number | null,
    runStart: null as number | null, firstWindow: null as number | null, windowEnd: null as number | null }]));
  const windIndex = new Map(wind.time.map((time, index) => [time, index]));
  const requiredHours = Math.max(2, spot.criteria.minConsecutiveHours);
  for (let index = 0; index < wave.time.length; index++) {
    const time = wave.time[index];
    if (time * 1000 < now.getTime()) continue;
    const day = days.get(dayAt(time, formatter));
    if (!day || !withinHistoryHours(time, clock)) continue;
    const windAt = windIndex.get(time);
    const hour: HistoricalHour = {
      time, day: "", swellHeight: wave.first[index], swellPeriod: wave.second[index],
      swellDirection: wave.third?.[index] ?? null, windSpeed: windAt === undefined ? null : wind.first[windAt],
      windDirection: windAt === undefined ? null : wind.second[windAt],
    };
    if (hour.swellHeight !== null && hour.swellPeriod !== null && hour.swellDirection !== null &&
      hour.windSpeed !== null && hour.windDirection !== null) day.available++;
    if (!hourMatchesCriteria(hour, spot.criteria)) { day.run = 0; day.lastTime = null; day.runStart = null; continue; }
    if (day.lastTime !== null && time - day.lastTime === 3600) day.run++;
    else { day.run = 1; day.runStart = time; }
    day.lastTime = time;
    if (day.run >= requiredHours && day.firstWindow === null) day.firstWindow = day.runStart;
    if (day.firstWindow !== null && day.firstWindow === day.runStart) day.windowEnd = time + 3600;
  }
  const availableDays = [...days.values()].filter((day) => day.available >= requiredHours).length;
  if (!availableDays) return null;
  const matching = [...days.values()].filter((day) => day.firstWindow !== null);
  const windows = [...days].flatMap(([date, day]) => day.firstWindow === null ? []
    : [{ day: date, start: day.firstWindow, end: day.windowEnd! }]);
  return { windows, matchingDays: matching.length, availableDays, horizonDays: forecastAlertDays,
    requiredHours, nextWindowStart: matching[0]?.firstWindow ?? null,
    timezone: wave.timezone, checkedAt: now.getTime() };
};

const urlsFor = (spots: readonly SavedSpot[]): readonly [string, string] => {
  const coordinates = {
    latitude: spots.map((spot) => spot.point.latitude).join(","),
    longitude: spots.map((spot) => spot.point.longitude).join(","),
  };
  const common = { ...coordinates, forecast_days: "15", timezone: "auto", timeformat: "unixtime", cell_selection: "sea" };
  return [
    `https://marine-api.open-meteo.com/v1/marine?${new URLSearchParams({ ...common,
      models: "ncep_gfswave025", hourly: "swell_wave_height,swell_wave_period,swell_wave_direction" })}`,
    `https://api.open-meteo.com/v1/ecmwf?${new URLSearchParams({ ...common,
      models: "ecmwf_ifs", hourly: "wind_speed_10m,wind_direction_10m", wind_speed_unit: "ms" })}`,
  ];
};

const perSpot = (spots: readonly SavedSpot[], error: ForecastAlertError): ForecastAlertCheck[] =>
  spots.map((spot) => ({ id: spot.id, key: forecastAlertKey(spot), ok: false, error }));

export const loadForecastAlerts = async (
  spots: readonly SavedSpot[], now: Date, fetcher: typeof fetch = fetch,
): Promise<readonly ForecastAlertCheck[]> => {
  const checks: ForecastAlertCheck[] = [];
  for (let offset = 0; offset < spots.length; offset += 20) {
    const batch = spots.slice(offset, offset + 20);
    const [waveUrl, windUrl] = urlsFor(batch);
    try {
      const [waveResponse, windResponse] = await Promise.all([fetcher(waveUrl, { signal: AbortSignal.timeout(30_000) }), fetcher(windUrl, { signal: AbortSignal.timeout(30_000) })]);
      if (!waveResponse.ok || !windResponse.ok) { checks.push(...perSpot(batch, { kind: "network" })); continue; }
      const [waveRaw, windRaw]: unknown[] = await Promise.all([waveResponse.json(), windResponse.json()]);
      const waveRows = Array.isArray(waveRaw) ? waveRaw : [waveRaw];
      const windRows = Array.isArray(windRaw) ? windRaw : [windRaw];
      if (waveRows.length !== batch.length || windRows.length !== batch.length) {
        checks.push(...perSpot(batch, { kind: "invalid" })); continue;
      }
      for (let index = 0; index < batch.length; index++) {
        const spot = batch[index];
        const key = forecastAlertKey(spot);
        const wave = parseSeries(waveRows[index], ["swell_wave_height", "swell_wave_period", "swell_wave_direction"]);
        const wind = parseSeries(windRows[index], ["wind_speed_10m", "wind_direction_10m"]);
        if (!wave || !wind) { checks.push({ id: spot.id, key, ok: false, error: { kind: "invalid" } }); continue; }
        try {
          const summary = scoreForecastAlert(spot, wave, wind, now);
          checks.push(summary ? { id: spot.id, key, ok: true, summary }
            : { id: spot.id, key, ok: false, error: { kind: "unavailable" } });
        } catch { checks.push({ id: spot.id, key, ok: false, error: { kind: "invalid" } }); }
      }
    } catch { checks.push(...perSpot(batch, { kind: "network" })); }
  }
  return checks;
};

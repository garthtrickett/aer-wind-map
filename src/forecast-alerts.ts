import { alertRulesFor, forecastLookAhead, maxForecastDays, type AlertDayRule } from "./alert-rules.ts";
import { conditionSource, hourHasData, historyClock, withinHistoryHours, hourMatchesCriteria, type ConditionSource, type HistoricalHour } from "./history.ts";
import { linkedSpotGroup } from "./spot-links.ts";
import type { SavedSpot } from "./saved-spots.ts";

export const forecastAlertDays = maxForecastDays;
export const forecastSwell = { model: "meteofrance_wave", label: "Météo-France MFWAM", days: 10 } as const;
export const forecastSwellCoverage = `Swell forecasts extend up to ${forecastSwell.days} days; later days are unknown.`;
export type ForecastWindow = Readonly<{ day: string; start: number; end: number }>;
export type ForecastAlertSummary = Readonly<{
  windows: readonly ForecastWindow[];
  matchingDays: number;
  availableDays: number;
  availableDates?: readonly string[];
  horizonDays: number;
  requiredHours: number;
  nextWindowStart: number | null;
  timezone: string;
  checkedAt: number;
  linkedRequirements?: readonly Readonly<{ id: string; name: string; rules: readonly AlertDayRule[] }>[];
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
    !time.every((value, index) => Number.isInteger(value) && Number.isFinite(new Date(value * 1000).getTime()) &&
      (index === 0 || value > time[index - 1])) ||
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

export const forecastAlertKey = (spot: SavedSpot, catalog: readonly SavedSpot[] = []): string => {
  const group = linkedSpotGroup(spot, catalog);
  return JSON.stringify([group.spots.map((item) => [item.id, item.point, item.criteria, item.alertEnabled,
    alertRulesFor(item), forecastLookAhead(item), item.linkedSpotIds ?? []]), group.missing]);
};

type ScoringSpot = Pick<SavedSpot, "criteria" | "alertLookAheadDays">;
type ForecastPointData = Readonly<{ wave: ForecastSeries; wind: ForecastSeries }>;
type LinkedForecast = ForecastPointData & Readonly<{ spot: SavedSpot }>;

export const forecastSources = (spots: readonly ScoringSpot[]) => {
  const swell = spots.some((spot) => conditionSource(spot.criteria) !== "wind");
  const wind = spots.some((spot) => conditionSource(spot.criteria) !== "swell");
  return { label: [swell ? `${forecastSwell.label} primary swell` : "", wind ? "ECMWF IFS wind" : ""].filter(Boolean).join(" + "),
    coverage: swell ? forecastSwellCoverage : "Hourly wind forecasts cover up to 14 days." };
};

const seriesFor = (spot: ScoringSpot, data: ForecastPointData): ForecastSeries =>
  conditionSource(spot.criteria) === "wind" ? data.wind : data.wave;

const scoreGroup = (spot: ScoringSpot, data: ForecastPointData, linked: readonly LinkedForecast[], now: Date): ForecastAlertSummary | null => {
  const entries = [{ spot, ...data }, ...linked].map((entry) => ({ ...entry,
    waveIndex: new Map(entry.wave.time.map((time, index) => [time, index])),
    windIndex: new Map(entry.wind.time.map((time, index) => [time, index])),
    clock: historyClock(seriesFor(entry.spot, entry).timezone),
  }));
  const timezone = seriesFor(spot, data).timezone;
  const formatter = localDayFormatter(timezone);
  const today = dayAt(now.getTime() / 1000, formatter);
  const firstDay = Date.parse(`${today}T00:00:00Z`);
  const horizonDays = Math.min(forecastLookAhead(spot), ...linked.map((entry) => forecastLookAhead(entry.spot)));
  const dates = Array.from({ length: horizonDays }, (_, index) =>
    new Date(firstDay + index * 86_400_000).toISOString().slice(0, 10));
  const days = new Map(dates.map((date) => [date, { available: 0, run: 0, lastTime: null as number | null,
    runStart: null as number | null, firstWindow: null as number | null, windowEnd: null as number | null }]));
  const requiredHours = Math.max(2, ...entries.map((entry) => entry.spot.criteria.minConsecutiveHours));
  // Intersect raw UTC hours, not each point's first daily window: a later run may overlap.
  for (const time of seriesFor(spot, data).time) {
    if (time * 1000 < now.getTime()) continue;
    const day = days.get(dayAt(time, formatter));
    if (!day) continue;
    const hours = entries.map((entry) => {
      const waveAt = entry.waveIndex.get(time), windAt = entry.windIndex.get(time);
      const hour: HistoricalHour = { time, day: "",
        swellHeight: waveAt === undefined ? null : entry.wave.first[waveAt],
        swellPeriod: waveAt === undefined ? null : entry.wave.second[waveAt],
        swellDirection: waveAt === undefined ? null : entry.wave.third?.[waveAt] ?? null,
        windSpeed: windAt === undefined ? null : entry.wind.first[windAt],
        windDirection: windAt === undefined ? null : entry.wind.second[windAt] };
      return { hour, entry };
    });
    const daylight = entries.every((entry) => withinHistoryHours(time, entry.clock));
    if (daylight && hours.every(({ hour, entry }) => hourHasData(hour, entry.spot.criteria))) day.available++;
    if (!daylight || !hours.every(({ hour, entry }) => hourMatchesCriteria(hour, entry.spot.criteria))) {
      day.run = 0; day.lastTime = null; day.runStart = null; continue;
    }
    if (day.lastTime !== null && time - day.lastTime === 3600) day.run++;
    else { day.run = 1; day.runStart = time; }
    day.lastTime = time;
    if (day.run >= requiredHours && day.firstWindow === null) day.firstWindow = day.runStart;
    if (day.firstWindow !== null && day.firstWindow === day.runStart) day.windowEnd = time + 3600;
  }
  const availableDates = [...days].filter(([, day]) => day.available >= requiredHours).map(([date]) => date);
  if (!availableDates.length) return null;
  const windows = [...days].flatMap(([date, day]) => day.firstWindow === null ? []
    : [{ day: date, start: day.firstWindow, end: day.windowEnd! }]);
  return { windows, availableDates, matchingDays: windows.length, availableDays: availableDates.length, horizonDays,
    requiredHours, nextWindowStart: windows[0]?.start ?? null, timezone, checkedAt: now.getTime(),
    ...(linked.length ? { linkedRequirements: linked.map(({ spot: peer }) =>
      ({ id: peer.id, name: peer.name, rules: alertRulesFor(peer) })) } : {}),
  };
};

export const scoreForecastAlert = (spot: ScoringSpot, wave: ForecastSeries, wind: ForecastSeries, now: Date): ForecastAlertSummary | null =>
  scoreGroup(spot, { wave, wind }, [], now);

export const scoreForecastData = (spot: SavedSpot, data: ForecastData, now: Date): ForecastAlertSummary | null => {
  const linked = data.linked ?? [];
  const group = linkedSpotGroup(spot, linked.map((entry) => entry.spot));
  if (group.missing.length || group.spots.length !== linked.length + 1) return null;
  return scoreGroup(spot, data, linked, now);
};

export const forecastPeriodLabel = (period: Readonly<{ startDay: string; endDay: string }>): string => {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
  return `${format.format(new Date(`${period.startDay}T00:00:00Z`))}–${format.format(new Date(`${period.endDay}T00:00:00Z`))}`;
};

/** Scan every complete N-day period wholly inside the look-ahead horizon. Any rule can trigger. */
const evaluateDayRules = (summary: ForecastAlertSummary, dayRules: readonly AlertDayRule[]) => {
  const today = dayAt(summary.checkedAt / 1000, localDayFormatter(summary.timezone));
  const start = Date.parse(`${today}T00:00:00Z`);
  const dateAt = (offset: number): string => new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
  const rules = dayRules.map((rule) => {
    const periods = Array.from({ length: Math.max(0, summary.horizonDays - rule.withinDays + 1) }, (_, offset) => {
      const startDay = dateAt(offset), endDay = dateAt(offset + rule.withinDays - 1);
      const inside = (day: string): boolean => day >= startDay && day <= endDay;
      const windows = summary.windows.filter((window) => inside(window.day));
      return { startDay, endDay, matchingDays: windows.length, met: windows.length >= rule.minDays, windows,
        availableDays: summary.availableDates ? summary.availableDates.filter(inside).length : null };
    });
    const best = periods.reduce<(typeof periods)[number] | null>((previous, period) =>
      !previous || period.matchingDays > previous.matchingDays ? period : previous, null);
    const matchingPeriods = periods.filter((period) => period.met);
    const dates = new Set(matchingPeriods.flatMap((period) => period.windows.map((window) => window.day)));
    return { ...rule, matchingDays: best?.matchingDays ?? 0, met: matchingPeriods.length > 0,
      bestPeriod: best, matchingPeriods, availableDays: best?.availableDays ?? null,
      windows: summary.windows.filter((window) => dates.has(window.day)) };
  });
  const matchingDates = new Set(rules.flatMap((rule) => rule.windows.map((window) => window.day)));
  return { matched: rules.some((rule) => rule.met), rules,
    windows: summary.windows.filter((window) => matchingDates.has(window.day)) };
};

/** Each linked point must pass one of its own rules, using the same jointly matching days. */
export const evaluateForecastRules = (summary: ForecastAlertSummary, dayRules: readonly AlertDayRule[]) => {
  const own = evaluateDayRules(summary, dayRules);
  const linked = (summary.linkedRequirements ?? []).map((peer) => ({ ...peer,
    evaluation: evaluateDayRules(summary, peer.rules) }));
  const matched = own.matched && linked.every((peer) => peer.evaluation.matched);
  const windows = matched ? own.windows.filter((window) => linked.every((peer) =>
    peer.evaluation.windows.some((other) => other.day === window.day))) : [];
  return { ...own, matched: matched && windows.length > 0, windows, linked };
};

const urlsFor = (points: readonly SavedSpot["point"][]): readonly [string, string] => {
  const coordinates = {
    latitude: points.map((point) => point.latitude).join(","),
    longitude: points.map((point) => point.longitude).join(","),
  };
  const common = { ...coordinates, forecast_days: "15", timezone: "auto", timeformat: "unixtime", cell_selection: "sea" };
  return [
    `https://marine-api.open-meteo.com/v1/marine?${new URLSearchParams({ ...common,
      forecast_days: String(forecastSwell.days), models: forecastSwell.model,
      hourly: "swell_wave_height,swell_wave_period,swell_wave_direction" })}`,
    `https://api.open-meteo.com/v1/ecmwf?${new URLSearchParams({ ...common,
      models: "ecmwf_ifs", hourly: "wind_speed_10m,wind_direction_10m", wind_speed_unit: "ms" })}`,
  ];
};

export type ForecastData = ForecastPointData & Readonly<{ linked?: readonly LinkedForecast[] }>;
export type ForecastDataResult =
  | Readonly<{ ok: true; data: ForecastData }>
  | Readonly<{ ok: false; error: ForecastAlertError }>;

// Download once; both saved alerts and draft previews use the same data and scoring rules.
const loadForecastBatch = async (
  points: readonly SavedSpot["point"][], fetcher: typeof fetch, conditions: ConditionSource = "both",
): Promise<readonly ForecastDataResult[]> => {
  const failure = (kind: ForecastAlertError["kind"]): ForecastDataResult[] =>
    points.map(() => ({ ok: false, error: { kind } }));
  const [waveUrl, windUrl] = urlsFor(points);
  try {
    const [waveResponse, windResponse] = await Promise.all([
      conditions === "wind" ? null : fetcher(waveUrl, { signal: AbortSignal.timeout(30_000) }),
      conditions === "swell" ? null : fetcher(windUrl, { signal: AbortSignal.timeout(30_000) }),
    ]);
    if ((waveResponse && !waveResponse.ok) || (windResponse && !windResponse.ok)) return failure("network");
    const [waveRaw, windRaw]: unknown[] = await Promise.all([waveResponse?.json(), windResponse?.json()]);
    const waveRows = Array.isArray(waveRaw) ? waveRaw : [waveRaw];
    const windRows = Array.isArray(windRaw) ? windRaw : [windRaw];
    if ((waveResponse && waveRows.length !== points.length) || (windResponse && windRows.length !== points.length)) return failure("invalid");
    return points.map((_, index): ForecastDataResult => {
      let wave = parseSeries(waveRows[index], ["swell_wave_height", "swell_wave_period", "swell_wave_direction"]);
      let wind = parseSeries(windRows[index], ["wind_speed_10m", "wind_direction_10m"]);
      const blank = (series: ForecastSeries): ForecastSeries => ({ ...series,
        first: series.time.map(() => null), second: series.time.map(() => null), third: null });
      if (conditions === "wind" && wind) wave = blank(wind);
      if (conditions === "swell" && wave) wind = blank(wave);
      if (!wave || !wind) return { ok: false, error: { kind: "invalid" } };
      try { localDayFormatter(wave.timezone); }
      catch { return { ok: false, error: { kind: "invalid" } }; }
      return { ok: true, data: { wave, wind } };
    });
  } catch { return failure("network"); }
};

export const loadForecastPoint = async (
  point: SavedSpot["point"], fetcher: typeof fetch = fetch,
): Promise<ForecastDataResult> => (await loadForecastBatch([point], fetcher))[0];

const loadSpotData = async (spots: readonly SavedSpot[], fetcher: typeof fetch): Promise<ReadonlyMap<string, ForecastDataResult>> => {
  const data = new Map<string, ForecastDataResult>();
  for (const conditions of ["both", "swell", "wind"] as const) {
    const selected = spots.filter((spot) => conditionSource(spot.criteria) === conditions);
    for (let offset = 0; offset < selected.length; offset += 20) {
      const batch = selected.slice(offset, offset + 20);
      const results = await loadForecastBatch(batch.map((spot) => spot.point), fetcher, conditions);
      batch.forEach((spot, index) => data.set(spot.id, results[index]));
    }
  }
  return data;
};

const groupData = (spot: SavedSpot, catalog: readonly SavedSpot[], results: ReadonlyMap<string, ForecastDataResult>): ForecastDataResult => {
  const group = linkedSpotGroup(spot, catalog);
  if (group.missing.length) return { ok: false, error: { kind: "unavailable" } };
  const own = results.get(spot.id);
  if (!own?.ok) return own ?? { ok: false, error: { kind: "unavailable" } };
  const linked: LinkedForecast[] = [];
  for (const peer of group.spots.slice(1)) {
    const result = results.get(peer.id);
    if (!result?.ok) return result ?? { ok: false, error: { kind: "unavailable" } };
    linked.push({ spot: peer, ...result.data });
  }
  return { ok: true, data: { ...own.data, ...(linked.length ? { linked } : {}) } };
};

export const loadForecastGroup = async (spot: SavedSpot, catalog: readonly SavedSpot[], fetcher: typeof fetch = fetch): Promise<ForecastDataResult> => {
  const group = linkedSpotGroup(spot, catalog);
  if (group.missing.length) return { ok: false, error: { kind: "unavailable" } };
  return groupData(spot, catalog, await loadSpotData(group.spots, fetcher));
};

export const loadForecastAlerts = async (
  spots: readonly SavedSpot[], now: Date, fetcher: typeof fetch = fetch, catalog: readonly SavedSpot[] = spots,
): Promise<readonly ForecastAlertCheck[]> => {
  const needed = new Map<string, SavedSpot>();
  for (const spot of spots) for (const peer of linkedSpotGroup(spot, catalog).spots) needed.set(peer.id, peer);
  const results = await loadSpotData([...needed.values()], fetcher);
  return spots.map((spot): ForecastAlertCheck => {
    const identity = { id: spot.id, key: forecastAlertKey(spot, catalog) };
    const result = groupData(spot, catalog, results);
    if (!result.ok) return { ...identity, ...result };
    const summary = scoreForecastData(spot, result.data, now);
    return summary ? { ...identity, ok: true, summary } : { ...identity, ok: false, error: { kind: "unavailable" } };
  });
};

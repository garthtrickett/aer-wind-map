import { loadForecastPoint, type ForecastData } from "./forecast-alerts.ts";
import { calmWindThresholdKmh, directionInClockwiseRange, type ConditionSource, type HistoryCriteria } from "./history.ts";
import type { Point } from "./model.ts";

type Series = ForecastData["wind"];
export type CompassForecastData = Readonly<{ wind: Series | null; swell: Series | null }>;
export type CompassForecastResult = Readonly<{ ok: true; data: CompassForecastData }> | Readonly<{ ok: false }>;
export type CompassReading = Readonly<{
  time: number; timezone: string;
  wind: Readonly<{ direction: number | null; speedKmh: number | null; fits: boolean; calm: boolean }> | null;
  swell: Readonly<{ direction: number | null; height: number | null; period: number | null; fits: boolean }> | null;
}>;
const positive = (value: number | null | undefined): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const bearing = (value: number | null | undefined): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360 ? value % 360 : null;

export const loadCompassForecast = async (point: Point, source: ConditionSource, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<CompassForecastResult> => {
  const bounded: typeof fetch = (input, init) => fetcher(input, { ...init,
    signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
  const [wind, swell] = await Promise.all([
    source === "swell" ? null : loadForecastPoint(point, bounded, "wind"),
    source === "wind" ? null : loadForecastPoint(point, bounded, "swell"),
  ]);
  const data = { wind: wind?.ok ? wind.data.wind : null, swell: swell?.ok ? swell.data.wave : null };
  return data.wind || data.swell ? { ok: true, data } : { ok: false };
};

export const compassReadingAt = (data: CompassForecastData | null, time: number | null, criteria: HistoryCriteria): CompassReading | null => {
  if (!data || time === null || !Number.isFinite(time)) return null;
  const hour = Math.floor(time / 3600) * 3600;
  const windAt = data.wind?.time.indexOf(hour) ?? -1;
  const swellAt = data.swell?.time.indexOf(hour) ?? -1;
  let wind: CompassReading["wind"] = null, swell: CompassReading["swell"] = null;
  if (data.wind && windAt >= 0) {
    const speed = positive(data.wind.first[windAt]);
    const speedKmh = speed === null ? null : speed * 3.6;
    const direction = speed === 0 ? null : bearing(data.wind.second[windAt]);
    const calmLimit = calmWindThresholdKmh(criteria);
    const calm = speedKmh !== null && calmLimit > 0 && speedKmh <= calmLimit;
    wind = { direction, speedKmh, calm, fits: direction !== null && directionInClockwiseRange(direction, criteria.windFromStart, criteria.windFromEnd) };
  }
  if (data.swell && swellAt >= 0) {
    const height = positive(data.swell.first[swellAt]);
    const direction = height === 0 ? null : bearing(data.swell.third?.[swellAt]);
    swell = { direction, height, period: positive(data.swell.second[swellAt]),
      fits: direction !== null && directionInClockwiseRange(direction, criteria.swellFromStart, criteria.swellFromEnd) };
  }
  return { time: hour, timezone: data.wind?.timezone ?? data.swell?.timezone ?? "UTC", wind, swell };
};

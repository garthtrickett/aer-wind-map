import { forecastReadingAt, type CompassReading } from "./compass-forecast.ts";
import type { ForecastData, ForecastWindow } from "./forecast-alerts.ts";
import { conditionSource } from "./history.ts";
import type { SavedSpot } from "./saved-spots.ts";

export type ForecastRange = Readonly<{ min: number; max: number }>;
export type WindowConditions = Readonly<{
  name: string;
  hours: readonly CompassReading[];
  wind: Readonly<{ speed: ForecastRange | null; directions: readonly (number | null)[]; calm: boolean }> | null;
  swell: Readonly<{ height: ForecastRange | null; period: ForecastRange | null; directions: readonly (number | null)[] }> | null;
}>;

const range = (values: readonly (number | null | undefined)[]): ForecastRange | null => {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? { min: Math.min(...known), max: Math.max(...known) } : null;
};

/** Read the same UTC samples used by the matching window, keeping each linked point separate. */
export const forecastWindowConditions = (spot: SavedSpot, data: ForecastData, window: ForecastWindow): readonly WindowConditions[] => {
  const times: number[] = [];
  for (let time = window.start; time < window.end && times.length < 24; time += 3600) times.push(time);
  return [{ spot, ...data }, ...(data.linked ?? [])].map((entry) => {
    const source = conditionSource(entry.spot.criteria);
    const series = { wind: source === "swell" ? null : entry.wind, swell: source === "wind" ? null : entry.wave };
    const hours = times.map((time) => forecastReadingAt(series, time, entry.spot.criteria)!);
    return {
      name: entry.spot.name, hours,
      wind: source === "swell" ? null : {
        speed: range(hours.map((hour) => hour.wind?.speedKmh)),
        directions: hours.map((hour) => hour.wind?.direction ?? null),
        calm: hours.length > 0 && hours.every((hour) => hour.wind?.speedKmh === 0),
      },
      swell: source === "wind" ? null : {
        height: range(hours.map((hour) => hour.swell?.height)),
        period: range(hours.map((hour) => hour.swell?.period)),
        directions: hours.map((hour) => hour.swell?.direction ?? null),
      },
    };
  });
};

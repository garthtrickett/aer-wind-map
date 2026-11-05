import { conditionSource, historyClock, withinHistoryHours,
  type HistoricalData, type HistoryCriteria } from "./history.ts";

export const windDirections = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export const windSpeedBands = [
  { label: "2–5", min: 2, max: 5 },
  { label: "5–10", min: 5, max: 10 },
  { label: "10–15", min: 10, max: 15 },
  { label: "15–20", min: 15, max: 20 },
  { label: "≥20", min: 20, max: Infinity },
] as const;

export type WindDistribution = Readonly<{
  availableHours: number;
  expectedHours: number;
  calmHours: number;
  cells: readonly (readonly number[])[];
}>;

/** All local 06:00–18:00 winds, regardless of the marker's matching criteria.
 * Calm (<2 km/h) has no direction and shares the grid's denominator. */
export const monthlyWindDistribution = (data: HistoricalData, criteria: HistoryCriteria, month: number): WindDistribution | null => {
  if (conditionSource(criteria) === "swell" || !Number.isInteger(month) || month < 0 || month > 11) return null;
  const clock = historyClock(data.timezone);
  const cells = windDirections.map(() => windSpeedBands.map(() => 0));
  let availableHours = 0, calmHours = 0, expectedHours = 0;
  for (let year = data.startYear; year <= data.endYear; year++)
    expectedHours += new Date(Date.UTC(year, month + 1, 0)).getUTCDate() * 12;
  for (const hour of data.hours) {
    const year = Number(hour.day.slice(0, 4));
    if (year < data.startYear || year > data.endYear || Number(hour.day.slice(5, 7)) - 1 !== month ||
      !withinHistoryHours(hour.time, clock)) continue;
    if (hour.windSpeed === null || !Number.isFinite(hour.windSpeed) || hour.windSpeed < 0) continue;
    const speed = hour.windSpeed * 3.6;
    if (speed < 2) { availableHours++; calmHours++; continue; }
    const direction = hour.windDirection;
    if (direction === null || !Number.isFinite(direction) || direction < 0 || direction > 360) continue;
    const row = Math.floor(((direction + 22.5) % 360) / 45);
    const column = windSpeedBands.findIndex((band) => speed >= band.min && speed < band.max);
    cells[row][column]++;
    availableHours++;
  }
  return { availableHours, expectedHours, calmHours, cells };
};

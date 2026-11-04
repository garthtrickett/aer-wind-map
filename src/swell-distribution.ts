import { conditionSource, historyClock, hourHasData, hourMatchesCriteria, withinHistoryHours,
  type HistoricalData, type HistoryCriteria } from "./history.ts";

export const swellHeightBands = [
  { label: "<0.5 m", min: 0, max: .5 },
  { label: "0.5–1.3 m", min: .5, max: 1.3 },
  { label: "1.3–2 m", min: 1.3, max: 2 },
  { label: "2–3 m", min: 2, max: 3 },
  { label: "≥3 m", min: 3, max: Infinity },
] as const;
export const swellPeriodBands = [
  { label: "<8 s", min: 0, max: 8 },
  { label: "8–10 s", min: 8, max: 10 },
  { label: "10–12 s", min: 10, max: 12 },
  { label: "12–14 s", min: 12, max: 14 },
  { label: "14–18 s", min: 14, max: 18 },
  { label: "≥18 s", min: 18, max: Infinity },
] as const;

export type SwellDistribution = Readonly<{
  withGoodWind: boolean;
  availableHours: number;
  expectedHours: number;
  includedHours: number;
  cells: readonly (readonly number[])[];
}>;

/** Joint frequencies from local 06:00–18:00 samples, independent of swell filters.
 * Combined markers keep every paired sample in the denominator, so each cell
 * measures the chance of that swell AND acceptable wind at the same hour. */
export const monthlySwellDistribution = (data: HistoricalData, criteria: HistoryCriteria, month: number): SwellDistribution | null => {
  if (conditionSource(criteria) === "wind" || !Number.isInteger(month) || month < 0 || month > 11) return null;
  const withGoodWind = conditionSource(criteria) === "both";
  const windCriteria: HistoryCriteria = { ...criteria, conditions: "wind" };
  const clock = historyClock(data.timezone);
  const cells = swellHeightBands.map(() => swellPeriodBands.map(() => 0));
  let availableHours = 0, includedHours = 0, expectedHours = 0;
  for (let year = data.startYear; year <= data.endYear; year++)
    expectedHours += new Date(Date.UTC(year, month + 1, 0)).getUTCDate() * 12;
  for (const hour of data.hours) {
    const year = Number(hour.day.slice(0, 4));
    if (year < data.startYear || year > data.endYear || Number(hour.day.slice(5, 7)) - 1 !== month ||
      !withinHistoryHours(hour.time, clock)) continue;
    const height = hour.swellHeight, period = hour.swellPeriod;
    if (height === null || period === null || !Number.isFinite(height) || !Number.isFinite(period) || height < 0 || period < 0 ||
      (withGoodWind && !hourHasData(hour, windCriteria))) continue;
    availableHours++;
    if (withGoodWind && !hourMatchesCriteria(hour, windCriteria)) continue;
    const row = swellHeightBands.findIndex((band) => height >= band.min && height < band.max);
    const column = swellPeriodBands.findIndex((band) => period >= band.min && period < band.max);
    cells[row][column]++;
    includedHours++;
  }
  return { withGoodWind, availableHours, expectedHours, includedHours, cells };
};

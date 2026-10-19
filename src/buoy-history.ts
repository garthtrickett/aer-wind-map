export type HistoryStation = Readonly<{ code: string; name: string; latitude: number; longitude: number; source: "CWA" | "NOWPHAS" }>;
export type WaveReading = Readonly<{
  time: string; height: number | null; period: number | null; meanPeriod: number | null; from: number | null; flag: number | null;
}>;
export type BuoyHistory = Readonly<{
  station: HistoryStation; date: string; timezone: "Asia/Tokyo" | "Asia/Taipei"; readings: readonly WaveReading[];
  status: "confirmed" | "provisional" | "archived"; publishedThrough: string | null; sourceUrl: string;
  periodLabel: "Significant wave period" | "Peak wave period"; note: string;
}>;
export type BuoyHistoryResult =
  | Readonly<{ ok: true; value: BuoyHistory }>
  | Readonly<{ ok: false; error: Readonly<{ kind: "network" | "unavailable" | "invalid"; message: string }> }>;

export const validHistoryDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  date >= "1970-01-01" && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export const loadBuoyHistory = async (station: string, date: string): Promise<BuoyHistoryResult> => {
  try {
    const response = await fetch(`/api/buoy-history?${new URLSearchParams({ station, date })}`, { signal: AbortSignal.timeout(90_000) });
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || !("ok" in value)) throw new Error("Invalid response");
    return value as BuoyHistoryResult;
  } catch {
    return { ok: false, error: { kind: "network", message: "The measured-wave archive could not be reached. Try again." } };
  }
};
export const buoyHistoryCsv = (data: BuoyHistory): string => [
  "time_utc,time_station_local,station_code,significant_wave_height_m,period_s,mean_period_s,wave_from_degrees,source_flag,status,period_definition",
  ...data.readings.map((row) => [row.time, new Date(Date.parse(row.time) + (data.timezone === "Asia/Tokyo" ? 9 : 8) * 3600_000).toISOString().slice(0, 19),
    data.station.code, row.height ?? "", row.period ?? "", row.meanPeriod ?? "", row.from ?? "", row.flag ?? "", data.status, data.periodLabel].join(",")),
].join("\n");

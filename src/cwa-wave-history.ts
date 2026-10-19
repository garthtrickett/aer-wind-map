import type { HistoryStation, WaveReading } from "./buoy-history.ts";
import type { Observation } from "./observations.ts";

export type CwaWaveSite = HistoryStation & Readonly<{ start: string; end: string }>;
export const parseCwaArchiveSites = (value: unknown): readonly CwaWaveSite[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>, latitude = Number(row.lat), longitude = Number(row.lon);
    return typeof row.stid === "string" && /^[A-Z0-9]{5,6}$/.test(row.stid) &&
      Number.isFinite(latitude) && latitude >= 20 && latitude <= 27 && Number.isFinite(longitude) && longitude >= 118 && longitude <= 124
      ? [{ code: row.stid, name: String(row.stnac || row.stid), latitude, longitude, source: "CWA" as const,
        start: String(row.datebeg || ""), end: String(row.dateend || "") }] : [];
  });
};
export const cwaArchiveMarkers = (sites: readonly CwaWaveSite[], current: readonly Observation[]): readonly Observation[] => {
  const byId = new Map(current.map((station) => [station.id, station]));
  return sites.map((site) => {
    const id = `cwa-buoy:${site.code}`, station = byId.get(id);
    return station ? { ...station, historyCode: site.code } : {
      id, name: site.name, latitude: site.latitude, longitude: site.longitude, source: "CWA", kind: "buoy", historyCode: site.code,
      sourceUrl: "https://ocean.cwa.gov.tw/V2/data_interface/datasets", observedAt: null,
      waveHeight: null, wavePeriod: null, meanPeriod: null, waveFrom: null, periodLabel: "Wave period",
      windSpeed: null, windFrom: null, variableWind: false, gust: null,
    };
  });
};
const number = (text: string | undefined, ceiling: number): number | null => {
  if (!text?.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value < ceiling ? value : null;
};
const compass: Readonly<Record<string, number>> = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
export const parseCwaWaveArchive = (text: string, code: string): readonly WaveReading[] => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === "st,yyyymmddhhmi,H,T,Tmean,D");
  // Unit declarations are part of the archive contract. Fail visibly if the
  // provider changes them rather than silently treating centimetres as metres.
  if (headerIndex < 0 || !text.includes("公分(cm)") || !text.includes("0.1秒")) throw new Error("Unrecognised CWA archive units");
  return lines.slice(headerIndex + 1).flatMap((line) => {
    const [station, date, height, period, mean, direction] = line.split(",").map((cell) => cell.trim());
    if (station !== code || !date || !/^\d{12}$/.test(date)) return [];
    const localTime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(8, 10)}:${date.slice(10, 12)}:00+08:00`;
    if (!Number.isFinite(Date.parse(localTime))) return [];
    const h = number(height, 9999), p = number(period, 999), m = number(mean, 999), d = number(direction, 361);
    return [{ time: new Date(localTime).toISOString(), height: h === null ? null : h / 100,
      period: p && p > 0 ? p / 10 : null, meanPeriod: m && m > 0 ? m / 10 : null,
      from: d === null ? compass[direction ?? ""] ?? null : d % 360, flag: null }];
  });
};

import type { Observation } from "./observations.ts";
import type { HistoryStation, WaveReading } from "./buoy-history.ts";

export type NowphasSite = HistoryStation & Readonly<{ area: string; gps: boolean }>;
const attribute = (text: string, name: string): string => text.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
const element = (text: string, name: string): string => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "";
const label = (text: string): string => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const sectors = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export const parseNowphasSites = (xml: string): readonly NowphasSite[] => [...xml.matchAll(/<point\s([^>]+)>([\s\S]*?)<\/point>/g)].flatMap((match) => {
  const attributes = match[1]!, code = attribute(attributes, "code");
  const latitude = Number(attribute(attributes, "lat")), longitude = Number(attribute(attributes, "lon"));
  const name = label(element(match[2]!, "nameEng") || attribute(attributes, "name"));
  return /^\d{3}$/.test(code) && code !== "820" && attribute(attributes, "gFlg").split(",")[0] === "1" &&
    name && Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= 20 && latitude <= 50 && longitude >= 120 && longitude <= 155
    ? [{ code, name, latitude, longitude, source: "NOWPHAS", area: attribute(attributes, "chisei"), gps: attribute(attributes, "kansokumode") === "GPS" }] : [];
});
const measured = (text: string, maximum: number): number | null => {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value < maximum ? value : null;
};
export const parseNowphasCurrent = (xml: string, sites: readonly NowphasSite[]): readonly Observation[] => {
  const timestamps = xml.match(/<DataMap\s([^>]+)>/)?.[1] ?? "";
  const reports = new Map([...xml.matchAll(/<mapdata\s+code="(\d+)"[^>]*>([\s\S]*?)<\/mapdata>/g)].map((match) => [match[1]!, match[2]!]));
  return sites.map((site) => {
    const report = reports.get(site.code) ?? "";
    const rawTime = attribute(timestamps, site.gps ? "time20minGPS" : "time20min");
    const time = /^\d{12}$/.test(rawTime) ? `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)}T${rawTime.slice(8, 10)}:${rawTime.slice(10, 12)}:00+09:00` : "";
    const height = measured(element(report, "yugiha"), 99);
    const period = measured(element(report, "shiyuki"), 99);
    const sector = sectors.indexOf(element(report, "namimuki"));
    const from = sector >= 0 ? sector * 22.5 : measured(element(report, "namimuki"), 361);
    return { id: `nowphas:${site.code}`, name: site.name, latitude: site.latitude, longitude: site.longitude,
      kind: "buoy", source: "NOWPHAS", sourceUrl: "https://nowphas.mlit.go.jp/", historyCode: site.code,
      observedAt: height !== null && Number.isFinite(Date.parse(time)) ? new Date(time).toISOString() : null,
      waveHeight: height, wavePeriod: period && period > 0 ? period : null, waveFrom: height !== null && height > 0.25 && from !== null ? from % 360 : null,
      meanPeriod: null, periodLabel: "Significant wave period", windSpeed: null, windFrom: null, variableWind: false, gust: null,
    };
  });
};

// The published format is fixed width. Splitting on spaces corrupts 01:20,
// 23:40 and other fields whose adjacent numbers have no separating space.
export const parseNowphasHistory = (text: string, cadence: "20min" | "2hr" = "20min"): readonly WaveReading[] => {
  const timeWidth = cadence === "20min" ? 12 : 10;
  return text.split(/\r?\n/).flatMap((line) => {
    if (!/^\d{4}/.test(line) || line.length < timeWidth + 66) return [];
    const year = Number(line.slice(0, 4)), month = Number(line.slice(4, 6)), day = Number(line.slice(6, 8));
    const hour = Number(line.slice(8, 10)), minute = cadence === "20min" ? Number(line.slice(10, 12)) : 0;
    if (![year, month, day, hour, minute].every(Number.isInteger) || year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return [];
    const time = Date.UTC(year, month - 1, day, hour - 9, minute);
    const flag = Number(line.slice(timeWidth, timeWidth + 6));
    const height = [0, 4, 7, 77].includes(flag) ? measured(line.slice(timeWidth + 24, timeWidth + 30), 66) : null;
    const period = [0, 4, 7].includes(flag) ? measured(line.slice(timeWidth + 30, timeWidth + 36), 666) : null;
    const from = [0, 4].includes(flag) ? measured(line.slice(timeWidth + 60, timeWidth + 66), 361) : null;
    return [{ time: new Date(time).toISOString(), height, period: period && period > 0 ? period : null,
      from: height !== null && height > 0.25 && from !== null ? from % 360 : null, meanPeriod: null, flag }];
  });
};

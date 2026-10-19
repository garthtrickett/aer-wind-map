export type ObservationBounds = Readonly<{ south: number; west: number; north: number; east: number }>;
export type Observation = Readonly<{
  id: string; name: string; latitude: number; longitude: number;
  kind: "buoy" | "wind"; source: "CWA" | "NDBC" | "METAR"; sourceUrl: string;
  observedAt: string; windSpeed: number | null; windFrom: number | null; variableWind: boolean;
  gust: number | null; waveHeight: number | null; wavePeriod: number | null;
  meanPeriod: number | null; waveFrom: number | null; periodLabel: "Dominant period" | "Wave period";
}>;
export type ObservationIssue = Readonly<{ source: string; message: string }>;
export type ObservationBatch = Readonly<{ stations: readonly Observation[]; issues: readonly ObservationIssue[]; fetchedAt: string }>;
export type ObservationQuery = Readonly<{ bounds: ObservationBounds; buoys: boolean; wind: boolean }>;
export type ObservationResult =
  | Readonly<{ ok: true; value: ObservationBatch }>
  | Readonly<{ ok: false; error: Readonly<{ kind: "network" | "invalid"; message: string }> }>;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const observationNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 999 ? number : null;
};
const direction = (value: unknown): number | null => {
  const number = observationNumber(value);
  return number !== null && number <= 360 ? number % 360 : null;
};
const positive = (value: unknown): number | null => {
  const number = observationNumber(value);
  return number !== null && number > 0 ? number : null;
};
const coordinates = (latitude: unknown, longitude: unknown): Readonly<{ latitude: number; longitude: number }> | null => {
  if (latitude === "" || longitude === "" || latitude == null || longitude == null) return null;
  const lat = Number(latitude), lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { latitude: lat, longitude: lon } : null;
};
export const withinObservationBounds = (point: Readonly<{ latitude: number; longitude: number }>, bounds: ObservationBounds): boolean =>
  point.latitude >= bounds.south && point.latitude <= bounds.north &&
  (bounds.west <= bounds.east ? point.longitude >= bounds.west && point.longitude <= bounds.east
    : point.longitude >= bounds.west || point.longitude <= bounds.east);

const emptyReadings = {
  windSpeed: null, windFrom: null, variableWind: false, gust: null,
  waveHeight: null, wavePeriod: null, meanPeriod: null, waveFrom: null, periodLabel: "Wave period" as const,
};
const validInstant = (value: string): string | null => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export const parseCwaBuoys = (value: unknown): readonly Observation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry), point = coordinates(row.lat, row.lon);
    const observedAt = typeof row.dtime === "string" ? validInstant(`${row.dtime}+08:00`) : null;
    if (!point || !observedAt || typeof row.stid !== "string" || row.state !== "on") return [];
    // CWA's Q flag denotes a usable observation. Do not replace a missing
    // measured value with the portal's separate forecast or marker fields.
    const reading = (key: string): number | null => row[`${key}_qc`] === "Q" ? observationNumber(row[key]) : null;
    return [{ ...emptyReadings, ...point, id: `cwa-buoy:${row.stid}`,
      name: String(row.stnae || row.aliasname || row.stid), kind: "buoy" as const, source: "CWA" as const,
      sourceUrl: "https://ocean.cwa.gov.tw/V2/", observedAt,
      waveHeight: reading("WH"), wavePeriod: positive(reading("WP")), waveFrom: direction(reading("WDIR")),
      windSpeed: reading("SWIND"), windFrom: direction(reading("DWIND")), gust: reading("GUST"),
    }];
  });
};

export type CwaWindSite = Readonly<{ id: string; name: string; county: string; latitude: number; longitude: number }>;
export const parseCwaWindSites = (value: unknown): readonly CwaWindSite[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry), point = coordinates(row.Lat, row.Lon);
    return point && typeof row.ID === "string" && typeof row.CountyID === "string" &&
      typeof row.eItem === "string" && row.eItem.split(/,\s*/).includes("Wind")
      ? [{ ...point, id: row.ID, county: row.CountyID, name: `${row.eSTname || row.STname} · ${row.STname}` }] : [];
  });
};

const compassBearings: Readonly<Record<string, number>> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};
export const observationDirection = (bearing: number): string =>
  Object.keys(compassBearings)[Math.round(((bearing % 360) + 360) % 360 / 22.5) % 16]!;

export const parseCwaCountyWind = (text: string, sites: readonly CwaWindSite[], now: number): readonly Observation[] => {
  // This public CWA feed is a JavaScript data literal. Extract only its known
  // quoted data fields; never evaluate downloaded JavaScript.
  const rows = text.split(/['"]\d+['"]\s*:\s*\{\s*['"]StationStatus['"]/).slice(1);
  const byId = new Map(sites.map((site) => [site.id, site]));
  return rows.flatMap((row) => {
    if (!/^\s*:\s*['"]1['"]/.test(row)) return [];
    const field = (key: string): string => row.match(new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]*)['"]`))?.[1] ?? "";
    const site = byId.get(field("StationID"));
    const date = field("Date"), time = field("Time");
    if (!site || !/^\d{2}\/\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return [];
    const year = new Date(now + 8 * 3600_000).getUTCFullYear();
    const candidate = Date.parse(`${year}-${date.replace("/", "-")}T${time}:00+08:00`);
    // A Dec 31 report may still be the latest on Jan 1. Never turn it into a
    // report eleven months in the future by guessing the current year.
    const observedAt = validInstant(candidate > now + 24 * 3600_000
      ? `${year - 1}-${date.replace("/", "-")}T${time}:00+08:00`
      : `${year}-${date.replace("/", "-")}T${time}:00+08:00`);
    const wind = row.match(/['"]Wind['"]\s*:\s*\{\s*['"]MS['"]\s*:\s*\{\s*['"]C['"]\s*:\s*['"]([^'"]*)/);
    const gust = row.match(/['"]Gust['"]\s*:\s*\{\s*['"]MS['"]\s*:\s*\{\s*['"]C['"]\s*:\s*['"]([^'"]*)/);
    const from = row.match(/['"]WindDir['"]\s*:\s*\{[^}]*['"]E['"]\s*:\s*['"]([^'"]*)/)?.[1] ?? "";
    const windSpeed = observationNumber(wind?.[1]);
    if (!observedAt || windSpeed === null) return [];
    return [{ ...emptyReadings, id: `cwa-wind:${site.id}`, name: site.name, latitude: site.latitude, longitude: site.longitude,
      kind: "wind" as const, source: "CWA" as const, sourceUrl: `https://www.cwa.gov.tw/V8/E/W/OBS_Station.html?ID=${encodeURIComponent(site.id)}`,
      observedAt, windSpeed, gust: observationNumber(gust?.[1]), windFrom: compassBearings[from.toUpperCase()] ?? null,
      variableWind: /variable|VRB/i.test(from),
    }];
  });
};

export const parseMetars = (value: unknown): readonly Observation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry), point = coordinates(row.lat, row.lon);
    const observedAt = typeof row.obsTime === "number" && Number.isFinite(row.obsTime) && Math.abs(row.obsTime) < 8e12
      ? validInstant(new Date(row.obsTime * 1000).toISOString()) : null;
    if (!point || !observedAt || typeof row.icaoId !== "string") return [];
    // The raw METAR also distinguishes calm 00000KT, variable VRB, and a
    // missing direction. Never interpret a missing/variable direction as north.
    const rawWind = typeof row.rawOb === "string" ? row.rawOb.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/) : null;
    const conversion = rawWind?.[4] === "MPS" ? 1 : 0.514444;
    const windSpeed = rawWind ? Number(rawWind[2]) * conversion
      : observationNumber(row.wspd) === null ? null : Number(row.wspd) * 0.514444;
    if (windSpeed === null) return [];
    const variableWind = rawWind ? rawWind[1] === "VRB" : row.wdir === "VRB";
    return [{ ...emptyReadings, ...point, id: `metar:${row.icaoId}`, name: `${row.name || row.icaoId} · ${row.icaoId}`,
      kind: "wind" as const, source: "METAR" as const, observedAt,
      sourceUrl: `https://aviationweather.gov/data/metar/?id=${encodeURIComponent(row.icaoId)}`,
      windSpeed, variableWind, windFrom: windSpeed === 0 || variableWind ? null : direction(rawWind ? rawWind[1] : row.wdir),
      gust: rawWind ? rawWind[3] ? Number(rawWind[3]) * conversion : null
        : observationNumber(row.wgst) === null ? null : Number(row.wgst) * 0.514444,
    }];
  });
};

const xmlText = (text: string): string => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
export const parseNdbcNames = (text: string): ReadonlyMap<string, string> => new Map(
  [...text.matchAll(/<station\s[^>]*\bid="([^"]+)"[^>]*\bname="([^"]+)"[^>]*>/g)]
    .map((match) => [match[1]!.toLowerCase(), xmlText(match[2]!)]),
);
export const parseNdbcObservations = (text: string, names: ReadonlyMap<string, string> = new Map()): readonly Observation[] => {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || line.startsWith("#")) return [];
    const row = line.trim().split(/\s+/), point = coordinates(row[1], row[2]);
    if (row.length < 17 || !point || !/^\d{4}$/.test(row[3]!)) return [];
    const observedAt = validInstant(`${row[3]}-${row[4]}-${row[5]}T${row[6]}:${row[7]}:00Z`);
    if (!observedAt) return [];
    const waveHeight = observationNumber(row[11]), windSpeed = observationNumber(row[9]);
    if (waveHeight === null && windSpeed === null) return [];
    const id = row[0]!, label = names.get(id.toLowerCase());
    return [{ ...emptyReadings, ...point, id: `ndbc:${id}`, name: label ? `${label} · ${id}` : `NDBC ${id}`,
      kind: waveHeight === null ? "wind" as const : "buoy" as const, source: "NDBC" as const,
      sourceUrl: `https://www.ndbc.noaa.gov/station_page.php?station=${encodeURIComponent(id)}`, observedAt,
      windSpeed, windFrom: windSpeed === 0 ? null : direction(row[8]), gust: observationNumber(row[10]),
      waveHeight, wavePeriod: positive(row[12]), meanPeriod: positive(row[13]), waveFrom: direction(row[14]),
      periodLabel: "Dominant period" as const,
    }];
  });
};

export const loadObservations = async (query: ObservationQuery): Promise<ObservationResult> => {
  const parameters = new URLSearchParams({ ...Object.fromEntries(Object.entries(query.bounds).map(([key, value]) => [key, String(value)])),
    buoys: String(query.buoys), wind: String(query.wind) });
  try {
    const response = await fetch(`/api/observations?${parameters}`, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) return { ok: false, error: { kind: "network", message: `Observation request failed (${response.status}).` } };
    const value: unknown = await response.json(), batch = record(value);
    if (!Array.isArray(batch.stations) || !Array.isArray(batch.issues) || typeof batch.fetchedAt !== "string")
      return { ok: false, error: { kind: "invalid", message: "Observation data could not be read." } };
    return { ok: true, value: batch as ObservationBatch };
  } catch {
    return { ok: false, error: { kind: "network", message: "Observation feeds could not be reached. Try again." } };
  }
};

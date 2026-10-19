import {
  parseCwaBuoys, parseCwaCountyWind, parseCwaWindSites, parseMetars, parseNdbcNames, parseNdbcObservations,
  withinObservationBounds, type Observation, type ObservationBatch, type ObservationIssue, type ObservationQuery,
} from "../src/observations.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseNowphasCurrent, parseNowphasSites } from "../src/nowphas.ts";
import { cwaArchiveMarkers, parseCwaArchiveSites } from "../src/cwa-wave-history.ts";

export const parseObservationQuery = (parameters: URLSearchParams): ObservationQuery | null => {
  const values = ["south", "west", "north", "east"].map((key) => parameters.has(key) ? Number(parameters.get(key)) : NaN);
  const [south, west, north, east] = values as [number, number, number, number];
  const width = east >= west ? east - west : east - west + 360;
  if (!values.every(Number.isFinite) || south < -90 || north > 90 || south >= north ||
    Math.abs(west) > 180 || Math.abs(east) > 180 || width <= 0 || width > 60 || north - south > 40) return null;
  if (!["true", "false"].includes(parameters.get("buoys") ?? "") || !["true", "false"].includes(parameters.get("wind") ?? "")) return null;
  if (parameters.get("buoys") !== "true" && parameters.get("wind") !== "true") return null;
  return { bounds: { south, west, north, east }, buoys: parameters.get("buoys") === "true", wind: parameters.get("wind") === "true" };
};

export const serveObservationRequest = async (
  request: IncomingMessage, response: ServerResponse,
  load: (query: ObservationQuery) => Promise<ObservationBatch>,
): Promise<void> => {
  if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }).end(); return; }
  const query = parseObservationQuery(new URL(request.url || "/", "http://localhost").searchParams);
  if (!query) { response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Choose a smaller map area and valid observation layers." })); return; }
  try {
    const batch = await load(query);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" });
    response.end(JSON.stringify(batch));
  } catch {
    response.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Observation feeds could not be reached." }));
  }
};

export const createObservationFeed = (fetcher: typeof fetch = fetch, clock: () => number = Date.now) => {
  // Cache and share in-flight reads across users. All destinations are fixed
  // provider URLs; no client-supplied URL or credential is accepted.
  const cache = new Map<string, Readonly<{ expires: number; value: Promise<string> }>>();
  const read = (url: string, ttl = 300_000, init?: RequestInit): Promise<string> => {
    const key = `${url}:${String(init?.body ?? "")}`;
    const previous = cache.get(key);
    if (previous && previous.expires > clock()) return previous.value;
    const value = fetcher(url, { ...init, headers: { "User-Agent": "AerWeatherMap/1.0 (public weather observations)", ...init?.headers }, signal: AbortSignal.timeout(15_000) })
      .then(async (response) => {
        if (!response.ok && response.status !== 204) throw new Error(`Provider returned ${response.status}`);
        return response.status === 204 ? "[]" : response.text();
      });
    cache.set(key, { expires: clock() + ttl, value });
    void value.catch(() => { if (cache.get(key)?.value === value) cache.set(key, { expires: clock() + 30_000, value }); });
    while (cache.size > 96) cache.delete(cache.keys().next().value!);
    return value;
  };

  return async (query: ObservationQuery): Promise<ObservationBatch> => {
    const now = clock(), issues: ObservationIssue[] = [];
    const source = async (name: string, load: () => Promise<readonly Observation[]>): Promise<readonly Observation[]> => {
      try { return await load(); }
      catch { issues.push({ source: name, message: "This observation feed is temporarily unavailable." }); return []; }
    };
    const inTaiwan = query.bounds.north >= 20 && query.bounds.south <= 27 && query.bounds.west <= query.bounds.east && query.bounds.west <= 123 && query.bounds.east >= 118;
    const inJapan = query.bounds.north >= 20 && query.bounds.south <= 50 && query.bounds.west <= query.bounds.east && query.bounds.west <= 155 && query.bounds.east >= 123;
    const ndbc = source("NDBC", async () => {
      const [text, names] = await Promise.all([
        read("https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"),
        read("https://www.ndbc.noaa.gov/activestations.xml", 12 * 3600_000).catch(() => ""),
      ]);
      if (!text.startsWith("#STN")) throw new Error("Unexpected NDBC format");
      return parseNdbcObservations(text, parseNdbcNames(names)).filter((station) => query.buoys && station.waveHeight !== null || query.wind && station.windSpeed !== null);
    });
    const buoys = query.buoys && inTaiwan ? source("CWA wave stations", async () => {
      const localHour = new Date(Math.floor(now / 3600_000) * 3600_000 + 8 * 3600_000 - 3600_000).toISOString().slice(0, 13).replace("T", " ") + ":00:00";
      const text = await read("https://ocean.cwa.gov.tw/V2/main_menu_draw/get_api_buoy", 600_000, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
        body: new URLSearchParams({ time: localHour, group_type: "A_TYPE" }).toString(),
      });
      const value: unknown = JSON.parse(text);
      if (!Array.isArray(value) || !value.length) throw new Error("Unexpected CWA wave format");
      return parseCwaBuoys(value);
    }) : Promise.resolve([]);
    const cwaArchive = query.buoys && inTaiwan ? source("CWA wave archive", async () => {
      const value: unknown = JSON.parse(await read("https://ocean.cwa.gov.tw/V2/data_interface/download/get_station", 24 * 3600_000, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" }, body: "dataset_type=Buoy&factor=w",
      }));
      const sites = parseCwaArchiveSites(value);
      if (!sites.length) throw new Error("Unexpected CWA archive station list");
      return cwaArchiveMarkers(sites, await buoys);
    }) : Promise.resolve([]);
    const nowphas = query.buoys && inJapan ? source("Japan NOWPHAS", async () => {
      const [setup, current] = await Promise.all([
        read("https://nowphas.mlit.go.jp/PROG/xml/POINT_SETUP.xml", 24 * 3600_000),
        read("https://nowphas.mlit.go.jp/mapxml/").catch(() => ""),
      ]);
      const sites = parseNowphasSites(setup);
      if (!sites.length) throw new Error("Unexpected NOWPHAS station list");
      return parseNowphasCurrent(current, sites);
    }) : Promise.resolve([]);
    const metars = query.wind ? source("Airport METAR", async () => {
      // A bounded, slightly padded box makes neighbouring pans share a cache
      // entry. Split at the date line rather than requesting the whole globe.
      const { south, west, north, east } = query.bounds;
      const westEdge = Math.max(-180, Math.floor(west / 2) * 2), eastEdge = Math.min(180, Math.ceil(east / 2) * 2);
      const boxes = west <= east ? [[westEdge, eastEdge]] : [[westEdge, 180], [-180, eastEdge]];
      const batches = await Promise.all(boxes.map(async ([left, right]) => {
        const bbox = [Math.max(-90, Math.floor(south / 2) * 2), left, Math.min(90, Math.ceil(north / 2) * 2), right].join(",");
        const value: unknown = JSON.parse(await read(`https://aviationweather.gov/api/data/metar?bbox=${bbox}&format=json`));
        if (!Array.isArray(value)) throw new Error("Unexpected METAR format");
        if (value.length >= 400) issues.push({ source: "Airport METAR", message: "This area reached the provider's result limit. Zoom closer for more stations." });
        return parseMetars(value);
      }));
      return batches.flat();
    }) : Promise.resolve([]);
    const cwaWind = query.wind && inTaiwan ? source("CWA wind stations", async () => {
      const value: unknown = JSON.parse(await read("https://www.cwa.gov.tw/Data/js/Observe/OSM/C/STMap.json", 24 * 3600_000));
      const sites = parseCwaWindSites(value).filter((site) => withinObservationBounds(site, query.bounds));
      if (!Array.isArray(value)) throw new Error("Unexpected CWA station format");
      const counties = [...new Set(sites.map((site) => site.county))].filter((county) => /^\d{2,5}$/.test(county));
      const batches: (readonly Observation[])[] = [];
      // Four bounded workers avoid a burst of requests across Taiwan.
      const pending = [...counties];
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (pending.length) {
          const county = pending.shift()!;
          batches.push(await source(`CWA wind (${county})`, async () => {
            const text = await read(`https://www.cwa.gov.tw/Data/js/Observe/County/${county}.js`);
            if (!/var ST\s*=/.test(text)) throw new Error("Unexpected CWA wind format");
            const observations = parseCwaCountyWind(text, sites.filter((site) => site.county === county), now);
            if (!observations.length && sites.some((site) => site.county === county)) throw new Error("No readable CWA wind observations");
            return observations;
          }));
        }
      }));
      return batches.flat();
    }) : Promise.resolve([]);
    const results = (await Promise.all([ndbc, buoys, metars, cwaWind, cwaArchive, nowphas])).flat();
    return { stations: [...new Map(results.filter((station) => withinObservationBounds(station, query.bounds)).map((station) => [station.id, station])).values()],
      issues, fetchedAt: new Date(now).toISOString() };
  };
};

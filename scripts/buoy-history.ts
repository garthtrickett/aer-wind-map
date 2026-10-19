import type { IncomingMessage, ServerResponse } from "node:http";
import { parseNowphasHistory, parseNowphasSites } from "../src/nowphas.ts";
import { parseCwaArchiveSites, parseCwaWaveArchive } from "../src/cwa-wave-history.ts";
import { validHistoryDate, type BuoyHistoryResult, type WaveReading } from "../src/buoy-history.ts";
import { waveArchiveEntry } from "./wave-archive-zip.ts";

const japan = "https://nowphas.mlit.go.jp";
const taiwan = "https://ocean.cwa.gov.tw/V2/data_interface/download";
const unavailable = (message: string): BuoyHistoryResult => ({ ok: false, error: { kind: "unavailable", message } });
const optionValues = (html: string, id: string): readonly number[] => {
  const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? "";
  return [...select.matchAll(/<option[^>]*value="(\d+)"/g)].map((match) => Number(match[1]));
};
export const createBuoyHistoryFeed = (fetcher: typeof fetch = fetch, clock: () => number = Date.now) => {
  const cache = new Map<string, Readonly<{ expires: number; value: Promise<readonly WaveReading[]> }>>();
  let active = 0;
  let japaneseSites: ReturnType<typeof parseNowphasSites> = [], taiwaneseSites: ReturnType<typeof parseCwaArchiveSites> = [];
  const sitesExpire = new Map<string, number>();
  const sitesPromises = new Map<string, Promise<void>>();
  const read = async (url: string, init?: RequestInit): Promise<Response> => {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Wave provider returned ${response.status}`);
    return response;
  };
  const zip = async (response: Response): Promise<Uint8Array> => {
    if (Number(response.headers.get("Content-Length")) > 20 * 1024 * 1024) throw new Error("Wave archive too large");
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty wave archive");
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("Wave archive too large"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  };
  const sites = (provider: string): Promise<void> => {
    if ((sitesExpire.get(provider) ?? 0) > clock()) return Promise.resolve();
    const previous = sitesPromises.get(provider);
    if (previous) return previous;
    const promise = (provider === "nowphas"
      ? read(`${japan}/PROG/xml/POINT_SETUP.xml`).then((response) => response.text()).then((text) => {
        const parsed = parseNowphasSites(text);
        if (!parsed.length) throw new Error("Empty NOWPHAS station list");
        japaneseSites = parsed;
      })
      : read(`${taiwan}/get_station`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
        body: "dataset_type=Buoy&factor=w" }).then((response) => response.json()).then((value: unknown) => {
        const parsed = parseCwaArchiveSites(value);
        if (!parsed.length) throw new Error("Empty CWA station list");
        taiwaneseSites = parsed;
      })).then(() => { sitesExpire.set(provider, clock() + 3600_000); }).finally(() => { sitesPromises.delete(provider); });
    sitesPromises.set(provider, promise);
    return promise;
  };
  const cached = (key: string, load: () => Promise<readonly WaveReading[]>): Promise<readonly WaveReading[]> => {
    const previous = cache.get(key);
    if (previous && previous.expires > clock()) return previous.value;
    const value = load();
    cache.set(key, { expires: clock() + 6 * 3600_000, value });
    void value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
    while (cache.size > 8) cache.delete(cache.keys().next().value!);
    return value;
  };

  return async (stationId: string, date: string): Promise<BuoyHistoryResult> => {
    if (!validHistoryDate(date) || date > new Date(clock() + 9 * 3600_000).toISOString().slice(0, 10) ||
      !/^(nowphas:\d{3}|cwa-buoy:[A-Z0-9]{5,6})$/.test(stationId))
      return { ok: false, error: { kind: "invalid", message: "Choose a supported wave station and a valid past date." } };
    if (active >= 3) return unavailable("The wave archive is busy. Please try again shortly.");
    active++;
    try {
      const [provider, code] = stationId.split(":"), year = Number(date.slice(0, 4));
      await sites(provider!);
      const station = (provider === "nowphas" ? japaneseSites : taiwaneseSites).find((site) => site.code === code);
      if (!station) return unavailable("This station is not in the provider's accessible wave archive.");
      if (provider === "cwa-buoy") {
        const site = taiwaneseSites.find((site) => site.code === code)!;
        if (date < site.start || date > site.end) return unavailable(`This station's published record covers ${site.start} to ${site.end}.`);
        const rows = await cached(`${stationId}:${year}`, async () => {
          const parameters = new URLSearchParams({ dataset: "Wave-his", begin: String(year), end: String(year), factor: "w", download_type: "csv", station_id: code! });
          const bytes = await zip(await read(`${taiwan}/download_file?${parameters}`));
          const member = waveArchiveEntry(bytes, (name) => name.startsWith(`${year}_${code}_`) && name.endsWith("_wave.csv"));
          return member ? parseCwaWaveArchive(new TextDecoder().decode(member.bytes), code!) : [];
        });
        return { ok: true, value: { station, date, timezone: "Asia/Taipei", status: "archived", publishedThrough: null,
          periodLabel: "Peak wave period", sourceUrl: "https://ocean.cwa.gov.tw/V2/data_interface/datasets",
          note: "CWA measured waves. Archive gaps and later quality-control revisions are possible. Peak and mean periods describe combined waves, not primary swell.",
          readings: rows.filter((row) => new Date(Date.parse(row.time) + 8 * 3600_000).toISOString().startsWith(date)) } };
      }
      const response = await read(`${japan}/pastdata_select/`), html = await response.text();
      const confirmed = Math.max(...optionValues(html, "start_yy"));
      // Month selectors always list all twelve months, even unpublished ones.
      // The provider's navigation script contains the actual newest range.
      const navigation = await (await read(`${japan}/pastdatars/js/pastdata.js`)).text();
      const newest = navigation.match(/\/pastdata_select\/\d{4}\/\d{1,2}\/(\d{4})\/(\d{1,2})\/?["']/);
      const lastYear = Number(newest?.[1]), lastMonth = Number(newest?.[2]);
      const through = `${lastYear}-${String(lastMonth).padStart(2, "0")}`;
      if (!Number.isFinite(confirmed) || !Number.isFinite(lastYear) || !Number.isFinite(lastMonth)) throw new Error("Missing NOWPHAS publication dates");
      if (year > confirmed && date.slice(0, 7) > through) return unavailable(`NOWPHAS archives are published through ${through}. More recent measurements are not yet in the downloadable archive.`);
      const provisional = year > confirmed;
      const key = `${stationId}:${provisional ? date.slice(0, 7) : year}`;
      const rows = await cached(key, async () => {
        const seq = html.match(/name="seq_id" value="([a-f0-9]+)"/)?.[1];
        if (!seq) throw new Error("Missing NOWPHAS download form");
        const site = japaneseSites.find((site) => site.code === code)!;
        const parameters = new URLSearchParams({ start_yy: String(year), end_yy: String(year), code_list: "false", code_map: "false", seq_id: seq,
          checkedvtxt: provisional ? `${site.gps ? "12" : Number(site.area)},` : `${code}_20min_txt,${code}_2hr_txt,` });
        if (provisional) { parameters.set("start_mm", String(Number(date.slice(5, 7)))); parameters.set("end_mm", String(Number(date.slice(5, 7)))); }
        const cookie = response.headers.get("set-cookie")?.split(";")[0];
        const bytes = await zip(await read(`${japan}/pastdata_exe_${provisional ? "estimate" : "confirm"}download`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body: parameters.toString(),
        }));
        const pattern = new RegExp(`^h${code}e\\..*\\.txt$`, "i");
        let member = waveArchiveEntry(bytes, (name) => pattern.test(name));
        if (!member && !provisional) member = waveArchiveEntry(bytes, (name) => new RegExp(`^h${code}0\\..*\\.txt$`, "i").test(name));
        if (!member && provisional) {
          const nested = waveArchiveEntry(bytes, (name) => name.endsWith(".zip"));
          if (nested) member = waveArchiveEntry(nested.bytes, (name) => pattern.test(name));
        }
        return member ? parseNowphasHistory(new TextDecoder("shift_jis").decode(member.bytes), /^h\d{3}0\./i.test(member.name) ? "2hr" : "20min") : [];
      });
      return { ok: true, value: { station, date, timezone: "Asia/Tokyo", status: provisional ? "provisional" : "confirmed", publishedThrough: through,
        periodLabel: "Significant wave period", sourceUrl: `${japan}/pastdata`,
        note: "Waves observed by MLIT Ports and Harbours Bureau and processed by PARI. Provisional records may change. Significant wave period is not peak or primary-swell period.",
        readings: rows.filter((row) => new Date(Date.parse(row.time) + 9 * 3600_000).toISOString().startsWith(date)) } };
    } catch {
      return { ok: false, error: { kind: "network", message: "The provider's wave archive could not be read. Try again or check the source for this station and year." } };
    } finally { active--; }
  };
};

export const serveBuoyHistoryRequest = async (request: IncomingMessage, response: ServerResponse,
  load: (station: string, date: string) => Promise<BuoyHistoryResult>): Promise<void> => {
  if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }).end(); return; }
  const parameters = new URL(request.url || "/", "http://localhost").searchParams;
  const result = await load(parameters.get("station") ?? "", parameters.get("date") ?? "");
  response.writeHead(result.ok ? 200 : result.error.kind === "invalid" ? 400 : result.error.kind === "unavailable" ? 404 : 502,
    { "Content-Type": "application/json; charset=utf-8", "Cache-Control": result.ok ? "public, max-age=3600" : "no-store" });
  response.end(JSON.stringify(result));
};

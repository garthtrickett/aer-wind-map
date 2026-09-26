// Compiled as a classic worker so the decoder's published scripts can be loaded
// with importScripts. All network access and GRIB decoding stays here.
import { forecastUrl } from "./ecmwf.ts";
import type { Layer } from "./wave.ts";
type WorkerRun = { date: string; hour: number; id: string; startedAt: string };
type WorkerError = { kind: "network" | "unavailable" | "index" | "range" | "decode"; detail: string };
type IndexRow = { param: string; levtype: string; _offset: number; _length: number };
type FieldValues = { values: Float32Array; width: number; height: number; firstLatitude: number; firstLongitude: number; increment: number };
type RawModule = {
  FS: { writeFile: (path: string, bytes: Uint8Array) => void; unlink: (path: string) => void };
};
type GribHandle = {
  getLong: (key: string) => number;
  getDouble: (key: string) => number;
  getDoubleArray: (key: string) => number[];
  delete: () => void;
};
type Decoder = { openGrib: (path: string) => GribHandle };
type DecoderScope = DedicatedWorkerGlobalScope & {
  createEccodes: (options: { locateFile: (path: string) => string }) => Promise<RawModule>;
  module: { exports: { createEccodes: (raw: RawModule) => Promise<Decoder> } };
};
type FieldResult = { ok: true; value: FieldValues } | { ok: false; error: WorkerError };
type BytesResult = { ok: true; value: Uint8Array } | { ok: false; error: WorkerError };

const decoderScope = self as unknown as DecoderScope;
let decoderPromise: Promise<{ raw: RawModule; decoder: Decoder }> | null = null;

const fetchWeather = async (
  url: string, options?: RequestInit,
): Promise<{ status: number; ok: boolean; bytes: Uint8Array }> => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, options);
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      return { status: response.status, ok: response.ok, bytes: new Uint8Array(await response.arrayBuffer()) };
    }
    catch (cause) {
      if (attempt === 3) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error("Weather request exhausted its retries");
};

const decoderReady = (): Promise<{ raw: RawModule; decoder: Decoder }> => {
  if (decoderPromise) return decoderPromise;
  decoderPromise = (async () => {
    importScripts("/decoder/eccodes.js");
    const createWasmModule = decoderScope.createEccodes;
    decoderScope.module = { exports: {} as DecoderScope["module"]["exports"] };
    importScripts("/decoder/index.js");
    const raw = await createWasmModule({ locateFile: (path) => `/decoder/${path}` });
    const decoder = await decoderScope.module.exports.createEccodes(raw);
    return { raw, decoder };
  })();
  return decoderPromise;
};

const indexRows = async (run: WorkerRun, step: number, layer: Layer): Promise<{ ok: true; value: IndexRow[] } | { ok: false; error: WorkerError }> => {
  try {
    const response = await fetchWeather(forecastUrl(run, step, "index", layer));
    if (!response.ok) return { ok: false, error: { kind: "unavailable", detail: `Index HTTP ${response.status}` } };
    const rows = new TextDecoder().decode(response.bytes).trim().split("\n").map((line) => JSON.parse(line) as Partial<IndexRow>);
    if (!rows.every((row) => typeof row.param === "string" && typeof row.levtype === "string" && Number.isSafeInteger(row._offset) && Number.isSafeInteger(row._length))) {
      return { ok: false, error: { kind: "index", detail: "Invalid field index" } };
    }
    return { ok: true, value: rows as IndexRow[] };
  } catch (cause) {
    return { ok: false, error: { kind: "network", detail: String(cause) } };
  }
};

const downloadField = async (url: string, row: IndexRow): Promise<BytesResult> => {
  try {
    const end = row._offset + row._length - 1;
    const response = await fetchWeather(url, { headers: { Range: `bytes=${row._offset}-${end}` } });
    if (response.status !== 206) return { ok: false, error: { kind: "range", detail: `Field HTTP ${response.status}` } };
    const bytes = response.bytes;
    if (bytes.byteLength !== row._length) return { ok: false, error: { kind: "range", detail: "Field length disagrees with index" } };
    return { ok: true, value: bytes };
  } catch (cause) {
    return { ok: false, error: { kind: "network", detail: String(cause) } };
  }
};

const decodeField = async (bytes: Uint8Array, name: string): Promise<FieldResult> => {
  let raw: RawModule;
  let decoder: Decoder;
  try {
    ({ raw, decoder } = await decoderReady());
  } catch (cause) {
    decoderPromise = null;
    return { ok: false, error: { kind: "decode", detail: String(cause) } };
  }
  const path = `/${name}.grib2`;
  let handle: GribHandle | null = null;
  try {
    raw.FS.writeFile(path, bytes);
    handle = decoder.openGrib(path);
    const width = handle.getLong("Ni");
    const height = handle.getLong("Nj");
    const firstLatitude = handle.getDouble("latitudeOfFirstGridPointInDegrees");
    const firstLongitude = handle.getDouble("longitudeOfFirstGridPointInDegrees");
    const increment = handle.getDouble("iDirectionIncrementInDegrees");
    if (width !== 1440 || height !== 721 || increment !== 0.25 || handle.getLong("iScansNegatively") !== 0 || handle.getLong("jScansPositively") !== 0) {
      return { ok: false, error: { kind: "decode", detail: "Unexpected wind grid geometry" } };
    }
    const missing = handle.getLong("numberOfMissing");
    const missingValue = missing > 0 ? handle.getDouble("missingValue") : null;
    const values = Float32Array.from(
      handle.getDoubleArray("values"),
      (value) => missingValue !== null && value === missingValue ? Number.NaN : value,
    );
    if (values.length !== width * height) return { ok: false, error: { kind: "decode", detail: "Incomplete wind grid" } };
    return { ok: true, value: { values, width, height, firstLatitude, firstLongitude, increment } };
  } catch (cause) {
    return { ok: false, error: { kind: "decode", detail: String(cause) } };
  } finally {
    handle?.delete();
    try { raw.FS.unlink(path); } catch { /* A failed decode may never have written it. */ }
  }
};

decoderScope.onmessage = async (event: MessageEvent<{ key: string; run: WorkerRun; step: number; layer: Layer }>): Promise<void> => {
  const { key, run, step, layer } = event.data;
  const index = await indexRows(run, step, layer);
  if (!index.ok) { decoderScope.postMessage({ key, ok: false, error: index.error }); return; }

  const rowFor = (param: string): IndexRow | undefined => index.value.find((row) => row.param === param && row.levtype === "sfc");
  const uRow = rowFor(layer === "wind" ? "10u" : "swh");
  const vRow = rowFor(layer === "wind" ? "10v" : "mwp");
  const gustRow = rowFor("10fg") ?? rowFor("10fg3");
  if (!uRow || !vRow) {
    decoderScope.postMessage({ key, ok: false, error: { kind: "index", detail: `${layer === "wind" ? "10 m wind" : "Wave height or period"} fields missing` } });
    return;
  }
  const url = forecastUrl(run, step, "grib2", layer);
  const [uBytes, vBytes, gustBytes] = await Promise.all([
    downloadField(url, uRow),
    downloadField(url, vRow),
    layer === "wind" && gustRow ? downloadField(url, gustRow) : Promise.resolve(null),
  ]);
  const failed = [uBytes, vBytes].find((item) => !item.ok);
  if (failed && !failed.ok) { decoderScope.postMessage({ key, ok: false, error: failed.error }); return; }
  if (!uBytes.ok || !vBytes.ok) return;

  const u = await decodeField(uBytes.value, `u-${key}`);
  const v = await decodeField(vBytes.value, `v-${key}`);
  const gust = gustBytes?.ok ? await decodeField(gustBytes.value, `gust-${key}`) : null;
  const bad = [u, v].find((item) => !item.ok);
  if (bad && !bad.ok) { decoderScope.postMessage({ key, ok: false, error: bad.error }); return; }
  if (!u.ok || !v.ok) return;

  if (u.value.width !== v.value.width || u.value.height !== v.value.height || u.value.firstLatitude !== v.value.firstLatitude || u.value.firstLongitude !== v.value.firstLongitude || u.value.increment !== v.value.increment) {
    decoderScope.postMessage({ key, ok: false, error: { kind: "decode", detail: "Forecast grids do not match" } });
    return;
  }
  const grid = {
    run, step, width: u.value.width, height: u.value.height,
    firstLatitude: u.value.firstLatitude, firstLongitude: u.value.firstLongitude,
    increment: u.value.increment,
  };
  const field = layer === "wind"
    ? { ...grid, kind: "wind", u: u.value.values, v: v.value.values, gust: gust?.ok ? gust.value.values : null }
    : { ...grid, kind: "waves", waveHeight: u.value.values, wavePeriod: v.value.values };
  const transfer: Transferable[] = [u.value.values.buffer, v.value.values.buffer];
  if (gust?.ok) transfer.push(gust.value.values.buffer);
  decoderScope.postMessage({ key, ok: true, field }, transfer);
};

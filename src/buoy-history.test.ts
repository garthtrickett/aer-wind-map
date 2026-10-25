import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { parseNowphasCurrent, parseNowphasHistory, parseNowphasSites } from "./nowphas.ts";
import { parseCwaArchiveSites, parseCwaWaveArchive } from "./cwa-wave-history.ts";
import { buoyHistoryCsv, validHistoryDate } from "./buoy-history.ts";
import { initialObservations, observationEffect, presentObservations } from "./observations-model.ts";
import { createBuoyHistoryFeed } from "../scripts/buoy-history.ts";
import { waveArchiveEntry } from "../scripts/wave-archive-zip.ts";

const setup = '<NowphasWeb><PointSetup><point code="818" chisei="09" name="宮崎日向沖" lat="32.3867" lon="131.9100" kansokumode="GPS" gFlg="1,0,1,1"><nameLang><nameEng>Hyuga,Miyazaki(buoy)</nameEng></nameLang></point></PointSetup></NowphasWeb>';
const japanese = '818  Miyazaki\n2024 1 1 020     0   209  0.67   5.7  1.04   6.9  1.26   7.0  1.73   7.4   171\n2024 1 1 040  9999  9999 99.99 999.9 99.99 999.9 99.99 999.9 99.99 999.9  9999';
const taiwanese = '波高：公分(cm)；週期：0.1秒(sec)\nst,yyyymmddhhmi,H,T,Tmean,D\n46761F,202512220000,110,67,51,71\n46761F,202512220100,,,-9999,\n46761F,202512220200,0,0,0,NNE';
const taiwanSites = { '46761F': { stid: "46761F", stnac: "成功浮球", lat: "23.1325", lon: "121.4201", datebeg: "2010-03-29", dateend: "2026-10-19" } };

// Minimal normal ZIP fixture exercises both compression methods used by the
// real providers, without retaining their full yearly archives in the repo.
const zip = (name: string, text: string | Uint8Array, method = 0): Buffer => {
  const body = typeof text === "string" ? Buffer.from(text) : Buffer.from(text);
  const payload = method === 8 ? deflateRawSync(body) : body, filename = Buffer.from(name);
  const local = Buffer.alloc(30), central = Buffer.alloc(46), footer = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(filename.length, 28);
  footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(1, 8); footer.writeUInt16LE(1, 10); footer.writeUInt32LE(central.length + filename.length, 12); footer.writeUInt32LE(local.length + filename.length + payload.length, 16);
  return Buffer.concat([local, filename, payload, central, filename, footer]);
};
test("NOWPHAS fixed-width history preserves 00:20, units, JST and missing flags", () => {
  const rows = parseNowphasHistory(japanese);
  assert.deepEqual(rows[0], { time: "2023-12-31T15:20:00.000Z", height: 1.04, period: 6.9, meanPeriod: null, from: 171, flag: 0 });
  assert.equal(rows[1]?.height, null);
  assert.equal(rows[1]?.period, null);
  assert.equal(rows[1]?.from, null);
  const older = parseNowphasHistory('2005 1 1 2     0   164  0.92   7.3  1.43   9.9  1.76  10.5  2.49  10.2   115', "2hr");
  assert.equal(older[0]?.height, 1.43); assert.equal(older[0]?.period, 9.9);
  assert.equal(older[0]?.time, "2004-12-31T17:00:00.000Z");
});
test("CWA archive converts centimetres and tenths of seconds, keeping peak and mean periods separate", () => {
  const rows = parseCwaWaveArchive(taiwanese, "46761F");
  assert.deepEqual(rows[0], { time: "2025-12-21T16:00:00.000Z", height: 1.1, period: 6.7, meanPeriod: 5.1, from: 71, flag: null });
  assert.equal(rows[1]?.height, null); assert.equal(rows[1]?.meanPeriod, null);
  assert.equal(rows[2]?.height, 0); assert.equal(rows[2]?.period, null); assert.equal(rows[2]?.from, 22.5);
  assert.throws(() => parseCwaWaveArchive(taiwanese.replace("0.1秒", "seconds"), "46761F"));
});
test("archive-only stations do not acquire invented current timestamps or wave heights", () => {
  const sites = parseNowphasSites(setup);
  assert.equal(sites[0]?.name, "Hyuga,Miyazaki(buoy)");
  assert.equal(parseNowphasSites(setup.replace('gFlg="1,0,1,1"', 'gFlg="0,1,0,0"')).length, 0, "Tide-only sites are not wave stations");
  const [missing] = parseNowphasCurrent('<DataMap time20minGPS="202610191620"><mapdata code="818"><yugiha>99999</yugiha></mapdata></DataMap>', sites);
  assert.equal(missing?.observedAt, null); assert.equal(missing?.waveHeight, null);
  const [current] = parseNowphasCurrent('<DataMap time20minGPS="202610191620"><mapdata code="818"><yugiha>1.2</yugiha><shiyuki>8.0</shiyuki><namimuki>NNE</namimuki></mapdata></DataMap>', sites);
  assert.equal(current?.observedAt, "2026-10-19T07:20:00.000Z"); assert.equal(current?.waveFrom, 22.5);
  assert.equal(parseCwaArchiveSites(taiwanSites)[0]?.code, "46761F");
});
test("ZIP reader accepts provider formats and rejects truncated or oversized entries", () => {
  for (const method of [0, 8]) assert.equal(Buffer.from(waveArchiveEntry(zip("wave.txt", japanese, method), (name) => name === "wave.txt")!.bytes).toString(), japanese);
  assert.equal(waveArchiveEntry(zip("wave.txt", "test"), (name) => name === "other.txt"), null);
  assert.throws(() => waveArchiveEntry(Buffer.from("no archive"), () => true));
  const oversized = zip("wave.txt", "test");
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); oversized.writeUInt32LE(40 * 1024 * 1024, central + 24);
  assert.throws(() => waveArchiveEntry(oversized, () => true));
});
test("historical server selects a real station and date, caches yearly reads, and keeps publication lag visible", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("POINT_SETUP.xml")) return new Response(setup);
    if (url.endsWith("get_station")) return Response.json(taiwanSites);
    if (url.includes("pastdata_select")) return new Response('<select id="start_yy"><option value="2024">2024</option></select><input name="seq_id" value="abc123">');
    if (url.endsWith("pastdata.js")) return new Response('window.location.href = "/pastdata_select/2026/1/2026/5";');
    if (url.includes("confirmdownload")) return new Response(zip("h818e.024.txt", japanese, 8));
    if (url.includes("estimatedownload")) return new Response(zip("12_202501.zip", zip("H818e.r2501.txt", japanese.replaceAll("2024", "2025"), 8)));
    if (url.includes("download_file")) return new Response(zip("2025_46761F_成功浮球_wave.csv", taiwanese));
    throw new Error(`Unexpected URL: ${url}`);
  };
  const feed = createBuoyHistoryFeed(fetcher, () => Date.parse("2026-10-19T08:00:00Z"));
  const first = await feed("nowphas:818", "2024-01-01");
  assert.ok(first.ok); assert.equal(first.value.readings[0]?.height, 1.04); assert.equal(first.value.publishedThrough, "2026-05");
  await feed("nowphas:818", "2024-01-02");
  assert.equal(calls.filter((url) => url.includes("confirmdownload")).length, 1);
  const provisional = await feed("nowphas:818", "2025-01-01");
  assert.ok(provisional.ok); assert.equal(provisional.value.status, "provisional");
  const recent = await feed("nowphas:818", "2026-10-01");
  assert.equal(recent.ok, false); if (!recent.ok) assert.match(recent.error.message, /05\/2026/);
  const taiwan = await feed("cwa-buoy:46761F", "2025-12-22");
  assert.ok(taiwan.ok); assert.equal(taiwan.value.readings.length, 3); assert.equal(taiwan.value.periodLabel, "Peak wave period");
  assert.match(buoyHistoryCsv(taiwan.value), /2025-12-21T16:00:00.000Z,2025-12-22T00:00:00,46761F,1.1,6.7,5.1,71/);
  const before = calls.length;
  assert.equal((await feed("https://example.com", "2025-01-01")).ok, false);
  assert.equal((await feed("nowphas:818", "2025-02-30")).ok, false);
  assert.equal(calls.length, before);
  assert.equal(validHistoryDate("2025-02-30"), false);
});
test("closing, changing date or selecting another buoy rejects late archive results", () => {
  const station = parseNowphasCurrent("", parseNowphasSites(setup))[0]!;
  let state = { ...initialObservations, selectedId: station.id, data: { stations: [station], issues: [], fetchedAt: "2026-10-19T08:00:00Z" } };
  state = presentObservations(state, { kind: "observationHistoryOpened", date: "2024-01-01" }) as typeof state;
  const effect = observationEffect(state); assert.equal(effect?.kind, "loadBuoyHistory");
  if (effect?.kind !== "loadBuoyHistory") return;
  state = presentObservations(state, { kind: "observationHistoryStarted", key: effect.key }) as typeof state;
  const changed = presentObservations(state, { kind: "observationHistoryDateChanged", date: "2024-01-02" });
  assert.equal(presentObservations(changed, { kind: "observationHistoryFailed", key: effect.key, message: "late" }), changed);
  const closed = presentObservations(state, { kind: "observationClosed" });
  assert.equal(presentObservations(closed, { kind: "observationHistoryFailed", key: effect.key, message: "late" }), closed);
});

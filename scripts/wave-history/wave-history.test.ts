import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeEcwam } from "./netcdf.ts";
import { openWaveStore, monthKeys, type Job } from "./store.ts";
import { advanceJob, marsRequest } from "./ecmwf.ts";
import { joinEcwamHistory } from "../../src/ecwam-history.ts";
import { defaultHistoryCriteria, hourHasData, hourMatchesCriteria, historyCsv, type HistoricalData } from "../../src/history.ts";
import { initialState, present, nap } from "../../src/model.ts";

const bytes = readFileSync(new URL("../../tests/fixtures/ecwam/november-2025-taiwan.nc", import.meta.url));
const month = decodeEcwam(bytes, 2025, 11, 23.25, 122.5);
function temporaryStore() {
  const dir = mkdtempSync(join(tmpdir(), "aer-ecwam-"));
  const path = join(dir, "cache.sqlite");
  return { path, dir, store: openWaveStore(path) };
}
const key = monthKeys(23.36, 122.42, 2025, 2025).find((key) => key.month === 11)!;
const credentials = { email: "test@example.invalid", key: "test-secret" };
const provider = "https://api.ecmwf.int/v1/datasets/research/requests/test-123";

test("decodes real packed primary and secondary swell for a complete month", () => {
  assert.equal(month.hours.length, 720);
  assert.equal(month.hours[0].time, Date.UTC(2025, 10, 1) / 1000);
  assert.ok(Math.abs(month.hours[0].primary.height! - 1.7187419232) < 1e-8);
  assert.ok(Math.abs(month.hours[0].primary.period! - 9.6264186182) < 1e-8);
  assert.ok(Math.abs(month.hours[0].secondary.direction! - 214.6616451119) < 1e-8);
  assert.throws(() => decodeEcwam(bytes, 2025, 10, 23.25, 122.5), /complete hourly/);
  assert.throws(() => decodeEcwam(bytes, 2025, 11, 34, 140), /cover/);
});
test("keys share a snapped cell and include UTC boundary months without inventing 2026 coverage", () => {
  const keys = monthKeys(23.36, 122.42, 2025, 2025);
  assert.equal(keys.length, 13);
  assert.equal(keys[0].year, 2024); assert.equal(keys[0].month, 12);
  assert.equal(keys.at(-1)!.year, 2025); assert.equal(keys.at(-1)!.month, 12);
  assert.equal(key.latitude, 23.375); assert.equal(key.longitude, 122.375);
  assert.equal(monthKeys(23.37, 122.43, 2025, 2025)[0].key, keys[0].key);
});
test("durable queue deduplicates and resumes saved provider receipts; uncertain POST does not resubmit", async () => {
  const { store, path, dir } = temporaryStore();
  try {
    store.enqueue([key], "user"); store.enqueue([key], "user");
    assert.equal(store.progress([key], true).pending, 1);
    let calls = 0;
    const submit: typeof fetch = async () => { calls++; return new Response(JSON.stringify({ status: "submitted" }), { status: 202, headers: { Location: provider } }); };
    await advanceJob(store, store.get(key.key)!, credentials, new AbortController().signal, submit);
    assert.equal(store.get(key.key)!.provider, provider); assert.equal(calls, 1);
    store.close();
    const reopened = openWaveStore(path);
    try {
      let method = "";
      await advanceJob(reopened, reopened.get(key.key)!, credentials, new AbortController().signal, async (_input, init) => {
        method = init?.method ?? "GET"; return new Response(JSON.stringify({ status: "active" }));
      });
      assert.equal(method, "GET");
      reopened.update(key.key, "queued", null);
      await advanceJob(reopened, reopened.get(key.key)!, credentials, new AbortController().signal, async () => { throw new Error("network uncertain"); });
      assert.equal(reopened.get(key.key)!.state, "failed");
      assert.equal(reopened.jobs(), undefined);
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("303 completion downloads without credentials and commits cache before DELETE", async () => {
  const { store, dir } = temporaryStore();
  const fixtureKey = { ...key, latitude: 23.25, longitude: 122.5 };
  try {
    store.enqueue([fixtureKey], "user"); store.update(key.key, "polling", provider);
    const methods: string[] = [];
    await advanceJob(store, store.get(key.key)!, credentials, new AbortController().signal, async (input, init) => {
      methods.push(init?.method ?? "GET");
      if (String(input).startsWith("https://apps.ecmwf.int/")) {
        assert.equal(init?.headers, undefined); return new Response(bytes);
      }
      if (init?.method === "DELETE") { assert.equal(store.get(key.key)!.state, "ready"); return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify({ href: "https://apps.ecmwf.int/api/streaming/public/test.nc", size: bytes.length }), { status: 303 });
    });
    assert.equal(store.get(key.key)!.state, "ready");
    assert.deepEqual(methods, ["GET", "GET", "DELETE"]);
    assert.equal(store.months([key])[0].hours.length, 720);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("joins UTC hours to local calendar days, preserves both components and valid no-swell availability", () => {
  const time = month.hours[0].time;
  const wind: HistoricalData = { startYear: 2025, endYear: 2025, timezone: "Asia/Taipei", waveGrid: { latitude: 23, longitude: 122 }, windGrid: { latitude: 23, longitude: 122 },
    hours: [{ time, day: "2025-11-01", windSpeed: 1, windDirection: 0, swellHeight: null, swellPeriod: null, swellDirection: null }] };
  const secondary = joinEcwamHistory(wind, [month], "secondary");
  assert.equal(secondary.hours[0].swellPeriod, month.hours[0].secondary.period);
  assert.equal(secondary.hours[0].primarySwell?.period, month.hours[0].primary.period);
  const absent = joinEcwamHistory(wind, [{ ...month, hours: [{ ...month.hours[0], secondary: { height: 0, period: 0, direction: 0 } }] }], "secondary");
  const criteria = { ...defaultHistoryCriteria, conditions: "swell" as const, minSwellHeight: 0, minSwellPeriod: 0 };
  assert.equal(hourHasData(absent.hours[0], criteria), true);
  assert.equal(hourMatchesCriteria(absent.hours[0], criteria), false);
  assert.match(historyCsv(secondary, criteria), /primary_height_m.*secondary_height_m/);
  assert.match(historyCsv(secondary, criteria), /ECMWF_ECWAM_CY50R1_hindcast,secondary,Tm-1_0/);
});
test("source and component survive save/reopen and stale source responses cannot replace current data", () => {
  let state = present(initialState, { kind: "locationSelected", point: { latitude: 23.36, longitude: 122.42 } });
  state = present(state, { kind: "historyOpened" });
  state = present(state, { kind: "historyWaveSourceChanged", source: "ecwam", partition: "secondary" });
  const effect = nap(state);
  assert.equal(effect?.kind, "loadHistory");
  if (effect?.kind !== "loadHistory") return;
  assert.equal(effect.waveSource, "ecwam"); assert.equal(effect.partition, "secondary");
  state = present(state, { kind: "historyLoadStarted", key: effect.key });
  state = present(state, { kind: "savedSpotNameChanged", name: "Taiwan" });
  state = present(state, { kind: "savedSpotSaved", id: "taiwan" });
  assert.equal(state.savedSpots[0].historyWaveSource, "ecwam");
  state = present(state, { kind: "historyWaveSourceChanged", source: "mfwam", partition: "primary" });
  const stale = present(state, { kind: "historyArchiveProgress", key: effect.key, progress: { configured: true, total: 13, ready: 1, pending: 12, failed: 0, missing: 0, active: null, error: null }, data: null });
  assert.equal(stale, state);
  state = present(state, { kind: "savedSpotOpened", id: "taiwan" });
  assert.equal(state.history.historySwellPartition, "secondary");
});
test("worker lease excludes overlapping replicas and retains known provider requests after expiry", () => {
  const { store, path, dir } = temporaryStore();
  const second = openWaveStore(path);
  try {
    store.enqueue([key], "user");
    assert.equal(store.claim("old-deployment", 1000)?.key, key.key);
    assert.equal(second.claim("new-deployment", 2000), undefined);
    store.update(key.key, "polling", provider);
    assert.equal(second.claim("new-deployment", 242000)?.provider, provider);
    assert.equal(store.claim("old-deployment", 243000), undefined);
    second.update(key.key, "submitting", null);
    assert.equal(store.claim("third-deployment", 500000), undefined);
    assert.equal(store.get(key.key)!.state, "failed");
  } finally { second.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("HTTP archive reads are public; queue creation requires both same origin and a live account", async () => {
  const { createWaveHistoryRuntime } = await import("./runtime.ts");
  const { createServer } = await import("node:http");
  const dir = mkdtempSync(join(tmpdir(), "aer-ecwam-http-"));
  const runtime = createWaveHistoryRuntime({ AER_WAVE_HISTORY_DB: join(dir, "cache.sqlite"), ECMWF_API_EMAIL: credentials.email,
    ECMWF_API_KEY: credentials.key, PUBLIC_APP_URL: "https://aer.example" }, () => "expired-session");
  const server = createServer((request, response) => { void runtime.handle(request, response); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/wave-history?latitude=23.36&longitude=122.42&startYear=2025&endYear=2025`;
  try {
    const response = await fetch(url); assert.equal(response.status, 200);
    assert.equal((await response.json() as { progress: { total: number } }).progress.total, 13);
    assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://aer.example" } })).status, 401);
    assert.equal((await fetch(url.replace("endYear=2025", "endYear=2026"))).status, 400);
    assert.equal((await fetch(url.replace("latitude=23.36", "latitude="))).status, 400);
    assert.equal((await fetch(url, { method: "DELETE" })).status, 405);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await runtime.stop(); rmSync(dir, { recursive: true, force: true }); }
});
test("reopening ECMWF history refreshes server progress instead of freezing a partial cached result", () => {
  const data: HistoricalData = { startYear: 2025, endYear: 2025, timezone: "Asia/Taipei", hours: [], waveGrid: key, windGrid: key };
  const spot = { id: "refresh", name: "Refresh archive", point: { latitude: 23.36, longitude: 122.42 }, startYear: 2025, endYear: 2025,
    historyWaveSource: "ecwam" as const, historySwellPartition: "primary" as const, criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 1 };
  let state = { ...initialState, savedSpots: [spot], history: { ...initialState.history, historyWaveSource: "ecwam" as const, point: spot.point, startYear: 2025, endYear: 2025, data } };
  const reopened = present(state, { kind: "savedSpotOpened", id: spot.id });
  assert.equal(reopened.history.phase, "needsData");
  assert.equal(nap(reopened)?.kind, "loadHistory");
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";
import { withinObservationBounds, type Observation } from "../src/observations.ts";
import { includeTaiwanWindStation } from "../src/taiwan-coast.ts";

const availablePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); reject(new Error("No port")); return; }
    server.close(() => resolve(address.port));
  });
});
const remoteBase = process.env.SMOKE_BASE_URL;
const port = remoteBase ? null : await availablePort();
const server = port === null ? null : spawn(process.execPath, ["scripts/serve.ts"], { stdio: "pipe", env: { ...process.env, PORT: String(port) } });
const base = remoteBase ?? `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(`${base}/health`)).ok; } catch { /* Server is starting. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Server did not start");
  const invalid = await fetch(`${base}/api/observations?south=-90&north=90&west=-180&east=180&wind=true&buoys=true`);
  assert.equal(invalid.status, 400);
  const live = await fetch(`${base}/api/observations?south=22.7&north=24.2&west=121&east=122&wind=true&buoys=true`);
  assert.ok(live.ok);
  const data = await live.json() as { stations: Observation[]; issues: unknown[] };
  assert.ok(data.stations.some((station) => station.id === "cwa-buoy:46761F"), "Live Chenggong wave measurement");
  assert.ok(data.stations.some((station) => station.id === "cwa-wind:46761"), "Live Chenggong wind measurement");
  console.log(JSON.stringify({ stage: "live server feeds", stations: data.stations.length, issues: data.issues }));

  for (const mode of ["vector", "raster", "mobile"] as const) {
    const context = await browser.newContext({ viewport: mode === "mobile" ? { width: 390, height: 844 } : { width: 1024, height: 768 },
      timezoneId: "Asia/Taipei", isMobile: mode === "mobile", hasTouch: mode === "mobile" });
    context.setDefaultTimeout(20_000);
    const spots = [
      { id: "taiwan", name: "Taiwan check", point: { latitude: 23.11, longitude: 121.39 } },
      { id: "bali", name: "Bali check", point: { latitude: -8.748, longitude: 115.167 } },
    ].map((spot) => ({ ...spot, startYear: 2025, endYear: 2025, criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 2 }));
    await context.addInitScript(({ mode, spots }) => {
      if (mode !== "vector") {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          return kind === "webgl2" ? null : original.call(this, kind, ...args);
        } as typeof original;
      }
      localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots }));
    }, { mode, spots });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/ecmwf-open-data/**", (route) => route.abort());
    await page.route("**/*.open-meteo.com/**", (route) => route.abort());
    const common = { windSpeed: null, windFrom: null, variableWind: false, gust: null, waveHeight: null,
      wavePeriod: null, meanPeriod: null, waveFrom: null, periodLabel: "Wave period" as const };
    const fixtures: Observation[] = [
      { ...common, id: "cwa-buoy:46761F", name: "Chenggong Wave Station", latitude: 23.1325, longitude: 121.4201,
        kind: "buoy", source: "CWA", sourceUrl: "https://ocean.cwa.gov.tw/V2/", observedAt: new Date(Date.now() - 6 * 3600_000).toISOString(), waveHeight: 1.8, wavePeriod: 14, waveFrom: 70 },
      { ...common, id: "cwa-wind:46761", name: "Chengkung · 成功", latitude: 23.097486, longitude: 121.373428,
        kind: "wind", source: "CWA", sourceUrl: "https://www.cwa.gov.tw/", observedAt: new Date().toISOString(), windSpeed: 1.2, windFrom: 337.5 },
      { ...common, id: "metar:WADD", name: "Ngurah Rai · WADD", latitude: -8.748, longitude: 115.167,
        kind: "wind", source: "METAR", sourceUrl: "https://aviationweather.gov/", observedAt: new Date().toISOString(), windSpeed: 0.514444, variableWind: true },
      { ...common, id: "cwa-wind:inland", name: "Taiwan inland test station", latitude: 23.097486, longitude: 121.27,
        kind: "wind", source: "CWA", sourceUrl: "https://www.cwa.gov.tw/", observedAt: new Date().toISOString(), windSpeed: 1.2, windFrom: 337.5 },
    ];
    let requests = 0;
    await page.route("**/api/observations?*", async (route) => {
      requests++;
      const params = new URL(route.request().url()).searchParams;
      const bounds = Object.fromEntries(["south", "west", "north", "east"].map((key) => [key, Number(params.get(key))])) as { south: number; west: number; north: number; east: number };
      const stations = fixtures.filter((station) => withinObservationBounds(station, bounds) &&
        (station.kind === "buoy" ? params.get("buoys") === "true" : params.get("wind") === "true") &&
        includeTaiwanWindStation(station, params.get("taiwanCoastalWind") !== "false"));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ stations, issues: [], fetchedAt: new Date().toISOString() }) });
    });
    const focusSpot = async (name: string): Promise<void> => {
      await page.getByRole("button", { name: /Saved spots 2/ }).click();
      await page.locator(".saved-spot-open").filter({ hasText: name }).click();
      await page.getByRole("button", { name: "Close history" }).click();
      await page.getByRole("button", { name: "Remove forecast flag" }).click();
      await page.waitForFunction(() => !document.querySelector("#map .leaflet-zoom-anim"));
    };
    await page.goto(base, { waitUntil: "domcontentloaded" });
    assert.equal(requests, 0, "Observations should not load before a layer is enabled");
    await focusSpot("Taiwan check");
    if (mode !== "mobile") {
      await page.locator(".leaflet-control-zoom-in").click({ modifiers: ["Shift"] });
      await page.waitForFunction(() => !document.querySelector("#map .leaflet-zoom-anim"));
    }
    await page.locator(".leaflet-control-zoom-in").click({ modifiers: ["Shift"] });
    await page.waitForFunction(() => !document.querySelector("#map .leaflet-zoom-anim"));
    await page.getByRole("button", { name: "Observations", exact: true }).click();
    await page.getByRole("checkbox", { name: /Wave buoys/ }).check();
    await page.locator('.buoy-marker[title="Chenggong Wave Station"]').waitFor();
    assert.equal(await page.locator(".observation-stale").count(), 1);
    await page.getByRole("button", { name: "Close observations", exact: true }).click();
    await page.locator('.buoy-marker[title="Chenggong Wave Station"]').click();
    const dialog = page.getByRole("dialog");
    assert.match(await dialog.innerText(), /1.8 m/);
    assert.match(await dialog.innerText(), /14.0 s/);
    assert.match(await dialog.innerText(), /Older report/);
    assert.match(await dialog.innerText(), /Measured, not forecast/);
    assert.ok((await dialog.locator(".observation-time").innerText()).includes("GMT+8"));
    const rect = await dialog.boundingBox();
    assert.ok(rect && rect.x >= 0 && rect.width <= (mode === "mobile" ? 390 : 1024));
    await page.screenshot({ path: `/tmp/aer-observation-${mode}-wave.png` });
    await page.getByRole("button", { name: "Close station details" }).click();
    await page.getByRole("button", { name: "Observations", exact: true }).click();
    await page.getByRole("checkbox", { name: /Wind stations/ }).check();
    await page.locator('.wind-marker[title="Chengkung · 成功"]').waitFor();
    const coastalFilter = page.getByRole("checkbox", { name: "Taiwan coastal wind only" });
    assert.equal(await coastalFilter.isChecked(), true);
    assert.equal(await page.locator('.wind-marker[title="Taiwan inland test station"]').count(), 0);
    await coastalFilter.uncheck();
    await page.locator('.wind-marker[title="Taiwan inland test station"]').waitFor();
    await coastalFilter.check();
    await page.locator('.wind-marker[title="Taiwan inland test station"]').waitFor({ state: "hidden" });
    await page.locator('.wind-marker[title="Chengkung · 成功"]').waitFor();
    await page.getByRole("button", { name: "Close observations", exact: true }).click();
    await page.locator('.wind-marker[title="Chengkung · 成功"]').click();
    assert.match(await dialog.innerText(), /NNW sector/);
    assert.match(await dialog.innerText(), /4.3 km\/h/);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await focusSpot("Bali check");
    await page.locator('.wind-marker[title="Ngurah Rai · WADD"]').waitFor();
    await page.locator('.wind-marker[title="Ngurah Rai · WADD"]').click();
    assert.match(await dialog.innerText(), /Variable/);
    assert.match(await dialog.innerText(), /1.9 km\/h/);
    await page.getByRole("button", { name: "Close station details" }).click();
    await page.getByRole("button", { name: "Observations", exact: true }).click();
    await page.getByRole("checkbox", { name: /Wind stations/ }).uncheck();
    await page.locator(".wind-marker").waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mode, stage: "markers, coastal filter and inland restoration, wave/wind details, timezones, stale, variable wind and layer toggles passed", requests, errors }));
    await context.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

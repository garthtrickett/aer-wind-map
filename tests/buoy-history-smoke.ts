import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";
import { withinObservationBounds, type Observation } from "../src/observations.ts";

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const socket = createServer(); socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    if (!address || typeof address === "string") { socket.close(); reject(new Error("No port")); return; }
    socket.close(() => resolve(address.port));
  });
});
const port = await freePort();
const server = spawn(process.execPath, ["scripts/serve.ts"], { stdio: "pipe", env: { ...process.env, PORT: String(port) } });
const base = `http://127.0.0.1:${port}`, browser = await chromium.launch({ headless: true });
const empty = { windSpeed: null, windFrom: null, variableWind: false, gust: null, waveHeight: null,
  wavePeriod: null, meanPeriod: null, waveFrom: null, periodLabel: "Wave period" as const, observedAt: null };
const stations: Observation[] = [
  { ...empty, id: "nowphas:818", historyCode: "818", name: "Hyuga,Miyazaki(buoy)", latitude: 32.3867, longitude: 131.91, kind: "buoy", source: "NOWPHAS", sourceUrl: "https://nowphas.mlit.go.jp/" },
  { ...empty, id: "cwa-buoy:46761F", historyCode: "46761F", name: "Chenggong Wave Station", latitude: 23.1325, longitude: 121.4201, kind: "buoy", source: "CWA", sourceUrl: "https://ocean.cwa.gov.tw/V2/", observedAt: new Date().toISOString(), waveHeight: 1.8, wavePeriod: 14 },
];
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { ready = (await fetch(`${base}/health`)).ok; } catch { /* Server starting. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      locale: "en-US", timezoneId: "Europe/London", isMobile: mobile, hasTouch: mobile });
    context.setDefaultTimeout(15_000);
    const spots = stations.map((station) => ({ id: station.id, name: station.name, point: { latitude: station.latitude, longitude: station.longitude },
      startYear: 2025, endYear: 2025, criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 2 }));
    await context.addInitScript((spots) => localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots })), spots);
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/ecmwf-open-data/**", (route) => route.abort());
    await page.route("**/*.open-meteo.com/**", (route) => route.abort());
    await page.route("**/api/observations?*", (route) => {
      const params = new URL(route.request().url()).searchParams;
      const bounds = { south: Number(params.get("south")), north: Number(params.get("north")), west: Number(params.get("west")), east: Number(params.get("east")) };
      return route.fulfill({ json: { stations: params.get("buoys") === "true" ? stations.filter((station) => withinObservationBounds(station, bounds)) : [], issues: [], fetchedAt: new Date().toISOString() } });
    });
    await page.route("**/api/buoy-history?*", (route) => {
      const params = new URL(route.request().url()).searchParams, id = params.get("station"), date = params.get("date")!;
      const japanese = id === "nowphas:818", offset = japanese ? "+09:00" : "+08:00";
      const station = stations.find((station) => station.id === id)!;
      if (date === "2026-10-01") return route.fulfill({ status: 404, json: { ok: false, error: { kind: "unavailable", message: "NOWPHAS archives are published through 05/2026." } } });
      return route.fulfill({ json: { ok: true, value: { station: { code: station.historyCode, name: station.name, source: station.source }, date,
        timezone: japanese ? "Asia/Tokyo" : "Asia/Taipei", status: japanese ? "confirmed" : "archived", publishedThrough: japanese ? "2026-05" : null,
        periodLabel: japanese ? "Significant wave period" : "Peak wave period", note: "Measured waves; gaps are not interpolated.", sourceUrl: station.sourceUrl,
        readings: date === "2024-01-02" ? [] : [
          { time: new Date(`${date}T00:00:00${offset}`).toISOString(), height: 1.1, period: 6.7, meanPeriod: japanese ? null : 5.1, from: 71, flag: 0 },
          { time: new Date(`${date}T06:00:00${offset}`).toISOString(), height: null, period: null, meanPeriod: null, from: null, flag: 9999 },
          { time: new Date(`${date}T12:00:00${offset}`).toISOString(), height: 2.2, period: 10.4, meanPeriod: null, from: 90, flag: 0 },
        ] } } });
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    for (const station of stations) {
      await page.getByRole("button", { name: /Saved spots 2/ }).click();
      await page.locator(".saved-spot-open").filter({ hasText: station.name }).click();
      await page.getByRole("button", { name: "Close history" }).click();
      await page.getByRole("button", { name: "Remove forecast flag" }).click();
      await page.waitForFunction(() => !document.querySelector("#map .leaflet-zoom-anim"));
      await page.getByRole("button", { name: "Observations", exact: true }).click();
      await page.getByRole("checkbox", { name: /Wave buoys/ }).check();
      await page.getByRole("button", { name: "Close observations", exact: true }).click();
      await page.locator(".buoy-marker").filter({ has: page.locator(".observation-marker-reading") }).first().click();
      const dialog = page.getByRole("dialog");
      assert.match(await dialog.innerText(), station.id.startsWith("nowphas") ? /no current report/ : /1.8 m/);
      await page.getByRole("button", { name: "Wave history", exact: true }).click();
      await page.getByRole("button", { name: "Download measured-wave CSV" }).waitFor();
      await page.getByLabel("Wave observation date").fill("01/01/2024");
      await page.getByRole("button", { name: "Load date", exact: true }).click();
      await page.getByRole("button", { name: "Download measured-wave CSV" }).waitFor();
      assert.equal(await dialog.locator("tbody tr").count(), 3);
      assert.match(await dialog.locator("tbody tr").first().innerText(), /00:00/);
      assert.match(await dialog.innerText(), station.id.startsWith("nowphas") ? /Significant wave period/ : /Peak wave period/);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download measured-wave CSV" }).click();
      assert.match((await download).suggestedFilename(), /aer-wave-observations-/);
      const box = await dialog.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= (mobile ? 390 : 1280));
      await page.screenshot({ path: `/tmp/aer-buoy-history-${mobile ? "mobile" : "desktop"}-${station.source}.png` });
      await page.getByLabel("Wave observation date").fill("02/01/2024");
      await page.getByRole("button", { name: "Load date", exact: true }).click();
      await page.getByText("Missing data does not mean flat waves.", { exact: false }).waitFor();
      if (station.id.startsWith("nowphas")) {
        await page.getByLabel("Wave observation date").fill("01/10/2026");
        await page.getByRole("button", { name: "Load date", exact: true }).click();
        await page.getByText("NOWPHAS archives are published through 05/2026.", { exact: true }).waitFor();
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mobile, result: "Japan and Taiwan: date lookup, source period labels, station-local times, missing data, publication lag, CSV and layout passed" }));
    await context.close();
  }
} finally { await browser.close(); server.kill(); }

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { chromium, type Browser } from "@playwright/test";

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
const server = port === null ? null : spawn(process.execPath, ["scripts/serve.ts"], {
  stdio: "pipe", env: { ...process.env, PORT: String(port) },
});
const base = remoteBase ?? `http://127.0.0.1:${port}`;
let browser: Browser | null = null;

try {
  browser = await chromium.launch({ headless: true });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(base)).ok; } catch { /* Static server is starting. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Preview server did not start");
  for (const raster of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC", acceptDownloads: true });
    context.setDefaultTimeout(20_000);
    await context.addInitScript(({ raster }) => {
      if (raster) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          return kind === "webgl2" ? null : original.call(this, kind, ...args);
        } as typeof original;
      }
      localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [{
        id: "zoom-check", name: "Bali zoom check", point: { latitude: -8.65, longitude: 115.215 },
        startYear: 2025, endYear: 2025, alertEnabled: false, alertMinDays: 2,
        criteria: { minSwellHeight: 1, maxSwellHeight: 3, minSwellPeriod: 10, maxWindSpeed: 5,
          windFromStart: 45, windFromEnd: 135, swellFromStart: 0, swellFromEnd: 360, minConsecutiveHours: 2 },
      }] }));
    }, { raster });
    const page = await context.newPage();
    const errors: string[] = [];
    const tileZooms: number[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const match = request.url().match(/tile\.openstreetmap\.org\/(\d+)\//);
      if (match) tileZooms.push(Number(match[1]));
    });
    await page.route("**/ecmwf-open-data/**", (route) => route.abort());
    const first = Date.parse("2025-01-01T00:00:00+08:00") / 1000;
    const time = Array.from({ length: 48 }, (_, hour) => first + hour * 3600);
    await page.route("**/*.open-meteo.com/v1/**", (route) => {
      const marine = route.request().url().includes("marine-api");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({
        latitude: -8.65, longitude: 115.215, timezone: "Asia/Makassar", hourly: {
          time,
          ...(marine ? { swell_wave_height: time.map(() => 2), swell_wave_period: time.map(() => 12), swell_wave_direction: time.map(() => 220) }
            : { wind_speed_10m: time.map(() => 3), wind_direction_10m: time.map((_, hour) => hour >= 24 || hour < 2 ? 90 : 180) }),
        },
      }) });
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    console.log(JSON.stringify({ raster, stage: "map loaded" }));
    await page.getByRole("button", { name: /Saved spots 1/ }).click();
    await page.locator(".saved-spot-open").click();
    await page.locator(".history-month").first().waitFor();
    console.log(JSON.stringify({ raster, stage: "history loaded" }));
    assert.match(await page.locator(".history-intro").innerText(), /06:00 and 18:00/);
    assert.match(await page.locator(".history-best").innerText(), /1 of 2 usable days/);
    assert.match(await page.locator(".history-days").innerText(), /12 hourly samples/);
    assert.match(await page.locator(".history-days").innerText(), /from 06:00/);
    const slider = page.getByRole("slider", { name: "Map zoom" });
    await slider.focus();
    await slider.press("End");
    assert.equal(await slider.inputValue(), "20");
    assert.equal(await page.locator("#history-map-zoom-value").innerText(), "20");
    await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>("#history-mini-map .leaflet-tile"))
      .some((image) => image.src.includes("tile.openstreetmap.org/19/") && image.naturalWidth > 0));
    console.log(JSON.stringify({ raster, stage: "preview tiles loaded at zoom 20" }));
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download hourly CSV" }).click();
    const path = await (await downloadEvent).path();
    assert.ok(path);
    const csv = (await readFile(path, "utf8")).trim().split("\n").slice(1).map((row) => row.split(","));
    assert.equal(csv.length, 48);
    assert.equal(csv.filter((row) => row[7] === "1").length, 12);
    assert.ok(csv.filter((row) => row[1] === "2025-01-01").every((row) => row[7] === "0"));
    await page.getByRole("button", { name: "Close history" }).click();
    await page.waitForFunction(() => !document.querySelector("#map .leaflet-zoom-anim"));
    const zoomIn = page.locator(".leaflet-control-zoom-in");
    let clicks = 0;
    while (!(await zoomIn.getAttribute("class"))?.includes("leaflet-disabled") && clicks < 20) {
      await zoomIn.click();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.waitForFunction(() => !document.querySelector("#map .leaflet-zoom-anim"));
      clicks++;
      console.log(JSON.stringify({ raster, mainZoomSteps: clicks }));
    }
    assert.equal(clicks, 14, "The main map should zoom from the saved-spot view at 6 up to 20");
    assert.match(await zoomIn.getAttribute("class") ?? "", /leaflet-disabled/);
    if (raster) {
      await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>("#map .leaflet-tile"))
        .some((image) => image.src.includes("tile.openstreetmap.org/19/") && image.naturalWidth > 0));
    }
    assert.ok(tileZooms.every((zoom) => zoom <= 19), "Raster zoom 20 must use available level-19 tiles");
    await page.screenshot({ path: `/tmp/aer-deep-zoom-${raster ? "raster" : "default"}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ base, raster, mainZoom: 20, previewZoom: 20, matchingDays: 1, csvMatches: 12, errors }));
    await context.close();
  }
} finally {
  await browser?.close();
  server?.kill();
}

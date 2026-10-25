import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";

const root = resolve("dist");
const server = createServer(async (request, response) => {
  const file = resolve(root, `.${new URL(request.url ?? "/", "http://localhost").pathname === "/" ? "/index.html" : new URL(request.url!, "http://localhost").pathname}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" } as Record<string, string>)[extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQiI8CAAGUAOIqyt2+AAAAAElFTkSuQmCC", "base64");
const time = Array.from({ length: 24 }, (_, i) => Date.parse("2025-10-24T00:00:00+08:00") / 1000 + i * 3600);
try {
  for (const raster of [false, true]) for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(({ raster, criteria }) => {
      if (raster) {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          return kind === "webgl2" ? null : getContext.call(this, kind, ...args);
        } as typeof getContext;
      }
      localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [{ id: "test", name: "Test coast",
        point: { latitude: -8.7, longitude: 115.27 }, startYear: 2025, endYear: 2025, criteria, alertEnabled: false, alertMinDays: 2 }] }));
    }, { raster, criteria: defaultHistoryCriteria });
    let metadataRequests = 0, tileRequests = 0, failMetadata = false, failTiles = false;
    let releaseMetadata: (() => void) | null = null;
    let holdMetadata = false;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "tiles.openfreemap.org") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [
          { id: "street-background", type: "background", paint: { "background-color": "#bad5d2" } },
          { id: "hidden-original", type: "background", layout: { visibility: "none" }, paint: { "background-color": "red" } },
        ] }) }); return;
      }
      if (url.hostname === "api.maptiler.com") {
        if (url.pathname.endsWith("tiles.json")) {
          metadataRequests++;
          if (holdMetadata) await new Promise<void>((resolve) => { releaseMetadata = resolve; });
          await route.fulfill({ status: failMetadata ? 403 : 200, contentType: "application/json", body: JSON.stringify({ tiles: [
            "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=test-only"], minzoom: 0, maxzoom: 22, attribution: "© Imagery test provider" }) });
        } else {
          tileRequests++;
          const failed = failTiles && url.pathname.endsWith(".jpg");
          await route.fulfill({ status: failed ? 403 : 200, contentType: failed ? "text/plain" : "image/png", body: failed ? "unavailable" : pixel });
        }
        return;
      }
      if (url.hostname === "tile.openstreetmap.org") { await route.fulfill({ contentType: "image/png", body: pixel }); return; }
      if (url.pathname.startsWith("/api/telegram/")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: { available: false, connected: false,
          pending: false, revision: 0, spotCount: 0, lastCheckedAt: null, lastSentAt: null, issue: null } }) }); return;
      }
      if (url.hostname.endsWith("open-meteo.com")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ latitude: -8.7, longitude: 115.27, timezone: "Asia/Makassar",
          hourly: { time, ...(url.hostname.startsWith("marine") ? { swell_wave_height: time.map(() => 1.2), swell_wave_period: time.map(() => 8),
            swell_wave_direction: time.map(() => 220) } : { wind_speed_10m: time.map(() => 1), wind_direction_10m: time.map(() => 90) }) } }) }); return;
      }
      if (url.origin === new URL(base).origin) await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
    assert.equal(metadataRequests, 0);
    await page.getByRole("button", { name: /^Saved spots / }).click();
    await page.locator(".saved-spot-open").click();
    await page.getByRole("button", { name: "Close history" }).click();
    // Leaflet can finish its initial container resize after the saved-spot
    // camera animation. Compare settled screen coordinates, not its startup size.
    await expect.poll(async () => page.locator("#selected-flag").evaluate((element) =>
      Math.abs(parseFloat(element.style.left) - innerWidth / 2) < 2 && Math.abs(parseFloat(element.style.top) - innerHeight / 2) < 2)).toBe(true);
    const position = await page.locator("#selected-flag").evaluate((element) => [element.style.left, element.style.top]);
    if (!raster) await page.locator(".maplibregl-canvas").evaluate((element) => element.setAttribute("data-original", "yes"));
    holdMetadata = true;
    await page.getByRole("button", { name: "Satellite", exact: true }).click();
    await expect(page.locator(".basemap-tools")).toContainText("Loading imagery");
    await expect.poll(() => releaseMetadata !== null).toBe(true);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    holdMetadata = false; releaseMetadata!();
    await expect(page.locator(".basemap-tools")).not.toContainText("Loading imagery");
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Satellite", exact: true }).click();
    await expect(page.locator("#map")).toHaveAttribute("data-basemap", "satellite");
    await expect.poll(() => tileRequests).toBeGreaterThan(0);
    await expect(page.locator(".satellite-logo")).toBeVisible();
    await expect(page.locator(".leaflet-control-attribution")).toContainText("Imagery test provider");
    await expect(page.locator("#wind-arrows")).toBeHidden();
    await expect(page.locator("#wind-color")).toBeHidden();
    assert.deepEqual(await page.locator("#selected-flag").evaluate((element) => [element.style.left, element.style.top]), position);
    await expect(page.locator(".saved-spot-icon")).toHaveCount(1);
    if (!raster) await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("data-original", "yes");
    await page.getByLabel("Weather overlay").check();
    await expect(page.locator("#wind-arrows")).toBeVisible();
    if (raster) await expect(page.locator("#wind-color")).toBeVisible();
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.locator("#map")).toHaveAttribute("data-basemap", "map");
    await expect(page.locator(".satellite-logo")).toBeHidden();
    await page.getByRole("button", { name: "Satellite", exact: true }).click();
    assert.equal(metadataRequests, 1, "Background switches reuse metadata");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `/tmp/aer-satellite-${raster ? "raster" : "webgl"}-${viewport.width}.png`, fullPage: true });
    failMetadata = true;
    await page.reload();
    await page.getByRole("button", { name: "Satellite", exact: true }).click();
    await expect(page.locator(".basemap-tools")).toContainText("Map view restored");
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
    failMetadata = false; failTiles = true;
    await page.getByRole("button", { name: "Satellite", exact: true }).click();
    await expect(page.locator(".basemap-tools")).toContainText("Satellite imagery is unavailable");
    await expect(page.locator("#map")).toHaveAttribute("data-basemap", "map");
    assert.deepEqual(errors, []);
    console.log(`Map/satellite passed: ${raster ? "raster" : "WebGL"}, ${viewport.width}px; preserved location and renderer, clear imagery, overlay, credits, races and failure recovery.`);
    await context.close();
  }
} finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }

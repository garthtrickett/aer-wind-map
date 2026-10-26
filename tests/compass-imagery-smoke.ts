import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";

const root = resolve("dist");
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
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
const current = Math.floor(Date.now() / 3600000) * 3600;
const time = Array.from({ length: 48 }, (_, i) => current + (i - 12) * 3600);
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript((criteria) => localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [{
      id: "test", name: "Coastal satellite", point: { latitude: -8.7, longitude: 115.267 }, startYear: 2025, endYear: 2025,
      criteria, alertEnabled: false, alertMinDays: 2,
    }] })), defaultHistoryCriteria);
    let metadataRequests = 0, failMetadata = false, failTiles = false, holdMetadata = false;
    let releaseMetadata: (() => void) | null = null;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "api.maptiler.com") {
        if (url.pathname.endsWith("tiles.json")) {
          metadataRequests++;
          if (holdMetadata) await new Promise<void>((resolve) => { releaseMetadata = resolve; });
          await route.fulfill({ status: failMetadata ? 403 : 200, contentType: "application/json", body: JSON.stringify({
            tiles: ["https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=fixture"], minzoom: 0, maxzoom: 18,
            attribution: "© Coastal imagery test provider", tileSize: 256,
          }) });
        } else {
          const failed = failTiles && url.pathname.endsWith(".jpg");
          await route.fulfill({ status: failed ? 403 : 200, contentType: failed ? "text/plain" : "image/png", body: failed ? "unavailable" : pixel });
        }
        return;
      }
      if (url.hostname === "tile.openstreetmap.org") { await route.fulfill({ contentType: "image/png", body: pixel }); return; }
      if (url.pathname.startsWith("/api/telegram/")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: {
          available: false, connected: false, pending: false, revision: 0, spotCount: 0, lastCheckedAt: null, lastSentAt: null, issue: null,
        } }) }); return;
      }
      if (url.hostname.endsWith("open-meteo.com")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ timezone: "Asia/Makassar", hourly: { time,
          ...(url.hostname.startsWith("marine-") ? { swell_wave_height: time.map(() => 1.8), swell_wave_period: time.map(() => 12), swell_wave_direction: time.map(() => 225) }
            : { wind_speed_10m: time.map(() => 3), wind_direction_10m: time.map(() => 45) }),
        } }) }); return;
      }
      if (url.origin === new URL(base).origin) await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const open = async () => {
      await page.getByRole("button", { name: /^Saved spots / }).click();
      await page.locator(".saved-spot-open").click();
    };
    const mini = page.locator("#history-mini-map");
    await page.goto(base);
    assert.equal(metadataRequests, 0, "The compass must not load imagery before opening");
    await open();
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    await expect(mini.locator("img.leaflet-tile-loaded").first()).toBeVisible();
    await expect(page.locator(".history-map-logo")).toBeVisible();
    await expect(page.locator(".history-map-credit")).toContainText("Coastal imagery test provider");
    await expect(page.locator(".compass-current.wind")).toHaveAttribute("data-direction", "45");
    await page.getByLabel("Map zoom", { exact: true }).focus();
    await page.getByLabel("Map zoom", { exact: true }).press("End");
    await expect(page.locator("#history-map-zoom-value")).toHaveText("20");
    await expect.poll(() => mini.locator('img.leaflet-tile-loaded[src*="/satellite-v2/18/"]').count()).toBeGreaterThan(0);
    await page.getByLabel(/^Wind from/).fill("20");
    await page.getByLabel(/^Wind from/).press("Tab");
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    assert.equal(metadataRequests, 1, "Zoom and bearing edits reuse imagery metadata");
    await page.locator(".history-compass-column").screenshot({ path: `/tmp/aer-compass-satellite-${viewport.width}.png` });
    await page.getByRole("button", { name: "Close history" }).click();
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
    await open();
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    assert.equal(metadataRequests, 1, "Reopening reuses cached metadata");
    failTiles = true;
    await page.reload(); await open();
    await expect(mini).toHaveAttribute("data-basemap", "map");
    await expect(page.locator(".history-map-notice")).toContainText("Satellite unavailable");
    await expect(page.locator(".history-map-logo")).toBeHidden();
    await expect(page.locator(".history-map-credit")).toContainText("OpenStreetMap");
    await expect(page.getByRole("slider", { name: "Wind range start dot" })).toBeVisible();
    failTiles = false; failMetadata = true;
    await page.reload(); await open();
    await expect(page.locator(".history-map-notice")).toContainText("Satellite unavailable");
    failMetadata = false;
    await page.getByRole("button", { name: "Close history" }).click(); await open();
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    holdMetadata = true;
    await page.reload(); await open();
    await expect.poll(() => releaseMetadata !== null).toBe(true);
    await page.getByRole("button", { name: "Close history" }).click();
    holdMetadata = false; releaseMetadata!();
    await open();
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    assert.deepEqual(errors, [], "A late imagery reply must not touch a removed map");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await context.close();
    console.log(`Compass satellite passed: ${viewport.width}px; native detail, credits, cache, controls, failures and panel lifecycle.`);
  }
} finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }

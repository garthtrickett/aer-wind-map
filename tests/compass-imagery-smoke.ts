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
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript((criteria) => { if (!localStorage.getItem("aer.saved-spots.v1")) localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [{
      id: "test", name: "Coastal satellite", point: { latitude: -8.7, longitude: 115.267 }, startYear: 2025, endYear: 2025,
      criteria, alertEnabled: false, alertMinDays: 2,
    }, { id: "close", name: "Close-up satellite", point: { latitude: -8.7, longitude: 115.267 }, startYear: 2025, endYear: 2025,
      criteria, alertEnabled: false, alertMinDays: 2, mapZoom: 13.5,
    }] })); }, defaultHistoryCriteria);
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
    const open = async (name = "Coastal satellite") => {
      await page.getByRole("button", { name: /^Saved spots / }).click();
      await page.locator(".saved-spot-open").filter({ hasText: name }).click();
    };
    const mini = page.locator("#history-mini-map");
    await page.goto(base);
    assert.equal(metadataRequests, 0, "The compass must not load imagery before opening");
    await open();
    await expect(page.getByLabel("Map zoom", { exact: true })).toHaveValue("11");
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    await expect(mini.locator("img.leaflet-tile-loaded").first()).toBeVisible();
    await expect(page.locator(".history-map-logo")).toBeVisible();
    await expect(page.locator(".history-map-credit")).toContainText("Coastal imagery test provider");
    await expect(page.locator(".compass-current.wind")).toHaveAttribute("data-direction", "45");
    await expect(page.locator(".shore-reference-overlay")).toHaveCount(0);
    await page.getByRole("button", { name: "Set beach / reef angle", exact: true }).click();
    const lineAngle = page.getByRole("spinbutton", { name: /^Beach \/ reef line/ });
    const windAngles = page.locator('[data-relative-range="wind"]');
    const swellAngles = page.locator('[data-relative-range="swell"]');
    await expect(lineAngle).toHaveValue("0");
    await expect(windAngles).toContainText("−45°");
    await expect(windAngles).toContainText("+45°");
    await expect(swellAngles).toContainText("All directions");
    await expect(swellAngles).toContainText("360°");
    await page.getByLabel(/^Swell from/).fill("240"); await page.getByLabel(/^Swell from/).press("Tab");
    await page.getByLabel(/^Swell to/).fill("300"); await page.getByLabel(/^Swell to/).press("Tab");
    await expect(swellAngles).toContainText("−30°");
    await expect(swellAngles).toContainText("+30°");
    await expect(swellAngles).toContainText("60°");
    const shoreDot = page.getByRole("slider", { name: "Beach/reef line first dot", exact: true });
    await shoreDot.focus(); await shoreDot.press("ArrowRight");
    await expect(lineAngle).toHaveValue("1");
    await expect(windAngles).toContainText("−46°");
    await expect(windAngles).toContainText("+44°");
    await lineAngle.fill("0"); await lineAngle.press("Tab");
    await shoreDot.scrollIntoViewIfNeeded();
    const dotBox = await shoreDot.boundingBox(), compassBox = await page.locator(".history-compass-overlay").boundingBox();
    assert.ok(dotBox && compassBox);
    await page.mouse.move(dotBox.x + dotBox.width / 2, dotBox.y + dotBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(compassBox.x + compassBox.width * (140 + Math.sin(Math.PI / 4) * 80) / 280,
      compassBox.y + compassBox.height * (140 - Math.cos(Math.PI / 4) * 80) / 280, { steps: 5 });
    await page.mouse.up();
    await expect(lineAngle).toHaveValue("45");
    await expect(windAngles).toContainText("−90°");
    await page.getByRole("slider", { name: "Wind range start dot", exact: true }).focus();
    await page.getByRole("slider", { name: "Wind range start dot", exact: true }).press("ArrowRight");
    await expect(windAngles).toContainText("−89°");
    await page.getByRole("button", { name: "Flip sea side", exact: true }).click();
    await expect(lineAngle).toHaveValue("45");
    await expect(page.locator(".shore-reference-sea")).toContainText("SE 135°");
    await page.getByRole("button", { name: "Flip sea side", exact: true }).click();
    await expect(page.locator(".shore-reference-sea")).toContainText("NW 315°");
    await page.getByRole("button", { name: "Clear alignment", exact: true }).click();
    await expect(page.locator(".shore-reference-overlay")).toHaveCount(0);
    await expect(page.getByLabel(/^Wind from/)).toHaveValue("46");
    await page.getByRole("button", { name: "Set beach / reef angle", exact: true }).click();
    await lineAngle.fill("45"); await lineAngle.press("Tab");
    await page.getByLabel(/^Wind from/).fill("45"); await page.getByLabel(/^Wind from/).press("Tab");
    await expect(windAngles).toContainText("−90°");
    await page.locator(".history-compass-stage").scrollIntoViewIfNeeded();
    await page.locator(".history-compass-stage").screenshot({ path: `/tmp/aer-shore-reference-map-${viewport.width}.png` });
    await page.locator(".shore-reference-controls").scrollIntoViewIfNeeded();
    await page.locator(".shore-reference-controls").screenshot({ path: `/tmp/aer-shore-reference-${viewport.width}.png` });
    assert.ok(await page.locator(".shore-reference-controls").evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
    await page.getByLabel("Marker type", { exact: true }).selectOption("wind");
    await expect(swellAngles).toHaveCount(0);
    await expect(lineAngle).toHaveValue("45");
    await page.getByLabel("Marker type", { exact: true }).selectOption("swell");
    await expect(windAngles).toHaveCount(0);
    await page.getByLabel("Marker type", { exact: true }).selectOption("both");
    await expect(windAngles).toContainText("−90°");
    await page.getByLabel("Map zoom", { exact: true }).focus();
    await page.getByLabel("Map zoom", { exact: true }).press("End");
    await expect(page.locator("#history-map-zoom-value")).toHaveText("20");
    await expect.poll(() => mini.locator('img.leaflet-tile-loaded[src*="/satellite-v2/18/"]').count()).toBeGreaterThan(0);
    const setZoom = async (zoom: string) => page.getByLabel("Map zoom", { exact: true }).evaluate((element, zoom) => {
      (element as HTMLInputElement).value = zoom; element.dispatchEvent(new Event("input", { bubbles: true }));
    }, zoom);
    await setZoom("15.25");
    await expect(page.locator("#history-map-zoom-value")).toHaveText("15.25");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots[0].mapZoom), undefined);
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots[0].mapZoom), 15.25);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots[0].shoreNormal), 315);
    await page.getByLabel(/^Wind from/).fill("20");
    await page.getByLabel(/^Wind from/).press("Tab");
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    assert.equal(metadataRequests, 1, "Zoom and bearing edits reuse imagery metadata");
    await page.locator(".history-compass-column").screenshot({ path: `/tmp/aer-compass-satellite-${viewport.width}.png` });
    await page.getByRole("button", { name: "Close history" }).click();
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
    await open();
    await expect(mini).toHaveAttribute("data-basemap", "satellite");
    await expect(page.getByLabel("Map zoom", { exact: true })).toHaveValue("15.25");
    await expect(lineAngle).toHaveValue("45");
    await expect(page.locator(".shore-reference-sea")).toContainText("NW 315°");
    await expect.poll(() => mini.locator('img.leaflet-tile-loaded[src*="/satellite-v2/15/"]').count()).toBeGreaterThan(0);
    assert.equal(metadataRequests, 1, "Reopening reuses cached metadata");
    await setZoom("19");
    await page.getByRole("button", { name: "Close history" }).click(); await open();
    await expect(page.getByLabel("Map zoom", { exact: true })).toHaveValue("15.25");
    await page.getByRole("button", { name: "Close history" }).click(); await open("Close-up satellite");
    await expect(page.getByLabel("Map zoom", { exact: true })).toHaveValue("13.5");
    await expect(page.locator(".shore-reference-overlay")).toHaveCount(0);
    await page.reload(); await open();
    await expect(page.getByLabel("Map zoom", { exact: true })).toHaveValue("15.25");
    await expect(lineAngle).toHaveValue("45");
    await expect.poll(() => mini.locator('img.leaflet-tile-loaded[src*="/satellite-v2/15/"]').count()).toBeGreaterThan(0);
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
    console.log(`Compass satellite passed: ${viewport.width}px; saved per-spot zoom, reload, native detail, credits, cache, controls, failures and panel lifecycle.`);
  }
} finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }

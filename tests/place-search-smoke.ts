import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, firefox, expect } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";

const root = resolve("dist");
const server = createServer(async (request, response) => {
  const file = resolve(root, `.${new URL(request.url ?? "/", "http://localhost").pathname.replace(/^\/$/, "/index.html")}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" } as Record<string, string>)[extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await (process.env.BROWSER === "firefox" ? firefox : chromium).launch({ headless: true });
const spot = { id: "coastal-wind", name: "My coastal wind marker", point: { latitude: 15, longitude: 119 },
  startYear: 2025, endYear: 2025, criteria: { ...defaultHistoryCriteria, conditions: "wind" }, alertEnabled: false, alertMinDays: 2 };
const sanJuan = { text: "San Juan", place_name: "San Juan, La Union, Philippines", center: [120.33855, 16.66993], place_type: ["municipality"] };
const kudat = { text: "Kudat", place_name: "Kudat, Sabah, Malaysia", center: [116.84944, 6.88246], place_type: ["municipality"] };

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript((spot) => localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [spot] })), spot);
    let requests = 0, fail = true;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "api.maptiler.com" && url.pathname.startsWith("/geocoding/")) {
        requests++;
        const query = decodeURIComponent(url.pathname.slice("/geocoding/".length, -".json".length));
        assert.equal(url.searchParams.get("autocomplete"), "false");
        if (query === "Failure" && fail) { await route.fulfill({ status: 429 }); return; }
        const features = query === "No such place" ? [] : query === "San Juan" ? [
          { ...sanJuan, place_name: "San Juan, Puerto Rico", center: [-66, 18] }, sanJuan,
        ] : [kudat];
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ features }) }); return;
      }
      if (url.pathname.startsWith("/api/telegram/")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: {
          available: false, connected: false, pending: false, revision: 0, spotCount: 0, lastCheckedAt: null, lastSentAt: null, issue: null,
        } }) }); return;
      }
      if (url.origin === base) await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    const input = () => page.getByRole("searchbox", { name: "Find a place" });
    const search = async (query: string) => { await input().fill(query); await input().press("Enter"); };
    await input().fill("San Juan");
    assert.equal(requests, 0, "Typing alone must not contact geocoding");
    await input().press("Enter");
    await expect(page.locator(".place-search-results li")).toHaveCount(2);
    await page.screenshot({ path: `/tmp/aer-place-search-results-${viewport.width}.png` });
    await page.getByRole("button", { name: "San Juan San Juan, La Union, Philippines", exact: true }).click();
    await expect(page.locator(".place-search-results")).toBeHidden();
    await expect(input()).toBeFocused();
    await expect(page.locator(".flag-point")).toBeVisible();
    const flag = await page.locator(".flag-point").boundingBox();
    assert.ok(flag && flag.x > 0 && flag.x < viewport.width && flag.y > 0 && flag.y < viewport.height, "Search must center the flag in the visible map");
    await page.getByRole("button", { name: "Open forecast details" }).click();
    await expect(page.locator(".coordinates")).toContainText("16.67°N · 120.34°E");
    await search("Kudat");
    await page.getByRole("button", { name: "Kudat Kudat, Sabah, Malaysia", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".coordinates")).toContainText("6.88°N · 116.85°E");
    await search("No such place");
    await expect(page.locator(".place-search-results")).toContainText("No places found");
    await expect(page.locator(".coordinates")).toContainText("6.88°N · 116.85°E");
    await search("Failure");
    await expect(page.locator(".place-search-results")).toContainText("Place search is busy");
    fail = false;
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".place-search-results li")).toHaveCount(1);
    await page.getByRole("button", { name: "Dismiss place search results" }).click();
    await expect(input()).toBeFocused();
    await input().press("Enter");
    await expect(page.locator(".place-search-results li")).toHaveCount(1);
    await input().press("Escape");
    await expect(page.locator(".place-search-results")).toBeHidden();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close details", exact: true }).click();

    await page.getByRole("button", { name: /^Saved spots / }).click();
    await page.locator(".saved-spot-open").filter({ hasText: spot.name }).click();
    await expect(page.getByLabel("Marker type", { exact: true })).toHaveValue("wind");
    await search("Kudat");
    await page.getByRole("button", { name: "Kudat Kudat, Sabah, Malaysia", exact: true }).click();
    await expect(page.locator(".history-head")).toContainText("6.88°N · 116.85°E");
    await expect(page.getByLabel("Name this spot and season")).toHaveValue(spot.name);
    await expect(page.getByLabel("Marker type", { exact: true })).toHaveValue("wind");
    const storedPoint = () => page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots[0].point);
    assert.deepEqual(await storedPoint(), spot.point, "Relocation must remain a draft until saved");
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    assert.deepEqual(await storedPoint(), { longitude: 116.84944, latitude: 6.88246 });
    await page.screenshot({ path: `/tmp/aer-place-search-marker-${viewport.width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log(`Place search passed: ${viewport.width}px`);
    await context.close();
  }
} finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }

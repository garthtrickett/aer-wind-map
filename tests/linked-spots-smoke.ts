import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";
import type { SavedSpot } from "../src/saved-spots.ts";

const root = resolve("dist");
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" } as Record<string, string>)[extname(file)] ?? "application/octet-stream");
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const first = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 1000;
const times = Array.from({ length: 15 * 24 }, (_, index) => first + index * 3600);
const criteria = { ...defaultHistoryCriteria, windFromStart: 315, windFromEnd: 45, swellFromStart: 180, swellFromEnd: 270 };
const coast: SavedSpot = { id: "coast", name: "Nearshore wind", point: { latitude: -8.7, longitude: 115.1 },
  startYear: 2023, endYear: 2025, criteria: { ...criteria, conditions: "wind" }, alertEnabled: false,
  alertMinDays: 2, alertRules: [{ minDays: 2, withinDays: 4 }] };
const offshore: SavedSpot = { ...coast, id: "offshore", name: "Offshore swell", point: { latitude: -9, longitude: 115.1 },
  criteria: { ...criteria, conditions: "swell" }, alertEnabled: true };

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    let calmWind = false;
    await context.addInitScript((spots) => {
      if (!localStorage.getItem("aer.saved-spots.v1")) localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots }));
    }, [offshore, coast]);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/telegram/")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: {
          available: false, connected: false, pending: false, revision: 0, spotCount: 0,
          lastCheckedAt: null, lastSentAt: null, issue: null,
        } }) }); return;
      }
      if (url.pathname.startsWith("/v1/")) {
        const forecast = url.searchParams.has("forecast_days");
        const time = forecast ? times : Array.from({ length: 24 }, (_, index) => Date.parse("2025-01-01T00:00:00Z") / 1000 + index * 3600);
        const marine = url.hostname.startsWith("marine-");
        const count = url.searchParams.get("latitude")!.split(",").length;
        const row = { latitude: -8.75, longitude: 115.1, timezone: "UTC", hourly: { time, ...(marine
          ? { swell_wave_height: time.map((_, i) => !forecast || ([2, 3, 7, 8].includes(Math.floor(i / 24)) && i % 24 >= 6 && i % 24 < 10) ? 2 : 0),
            swell_wave_period: time.map(() => 12), swell_wave_direction: time.map(() => 220) }
          : { wind_speed_10m: time.map(() => forecast && calmWind ? .5 : 3),
            wind_direction_10m: time.map((_, i) => !forecast || ([3, 7, 8].includes(Math.floor(i / 24)) && i % 24 >= 8 && i % 24 < 11) ? 355 : 180) }) } };
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(count > 1 ? Array(count).fill(row) : row) }); return;
      }
      if (url.origin === new URL(base).origin) await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    const open = async (name: string) => {
      await page.getByRole("button", { name: /^Saved spots / }).click();
      await page.locator(".saved-spot-open").filter({ has: page.getByText(name, { exact: true }) }).click();
    };
    await open("Offshore swell");
    await expect(page.getByLabel("Marker type")).toHaveValue("swell");
    await expect(page.getByLabel("Wind speed at most")).toBeHidden();
    await expect(page.getByLabel("Wind direction ignored at or below")).toBeHidden();
    await expect(page.locator(".saved-spot-swell")).toHaveText("S");
    await expect(page.locator(".saved-spot-wind")).toHaveText("W");
    await expect(page.locator(".history-forecast-heading")).toContainText("4 of 14 days match");
    await page.locator(".history-linked-spots").getByLabel(/Nearshore wind/).check();
    await expect(page.locator(".history-forecast-heading")).toContainText("3 of 14 days match");
    await expect(page.locator(".history-forecast-heading")).toContainText("Your alert threshold is met.");
    await expect(page.locator(".history-linked-results")).toContainText("Nearshore wind: Met");
    await expect(page.locator(".history-forecast-windows li").first()).toContainText("08:00–10:00");
    await expect(page.locator(".history-forecast-windows li span").first()).toHaveText(/\d{2}\/\d{2}\/\d{4}/);
    const matchingDay = page.locator(".history-forecast-windows > li").first();
    await expect(matchingDay.locator(".forecast-window-point")).toHaveCount(2);
    const swellPoint = matchingDay.locator(".forecast-window-point").filter({ hasText: "Offshore swell" });
    const windPoint = matchingDay.locator(".forecast-window-point").filter({ hasText: "Nearshore wind" });
    await expect(swellPoint.locator(".forecast-window-swell")).toContainText("2.0 m · 12.0 s · SW");
    await expect(swellPoint.locator(".forecast-window-wind")).toHaveCount(0);
    await expect(windPoint.locator(".forecast-window-wind")).toContainText("10.8 km/h · N");
    await expect(windPoint.locator(".forecast-window-swell")).toHaveCount(0);
    await matchingDay.getByText("Hourly forecast", { exact: true }).click();
    await expect(matchingDay.locator("table")).toHaveCount(2);
    await expect(matchingDay.locator("table").first().locator("tbody tr")).toHaveCount(2);
    await expect(matchingDay.locator("table").last().locator("tbody tr").first()).toContainText("08:00");
    await expect(matchingDay.locator("table").last().locator("tbody tr").last()).toContainText("09:00");
    await matchingDay.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/aer-matching-forecast-conditions-${viewport.width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await matchingDay.getByText("Hourly forecast", { exact: true }).click();
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    await page.getByRole("button", { name: "Close history" }).click();
    await expect(page.locator('path.saved-spot-link')).toHaveCount(1);
    await page.reload();
    await open("Offshore swell");
    await expect(page.locator(".history-linked-spots").getByLabel(/Nearshore wind/)).toBeChecked();
    await expect(page.locator(".history-forecast-heading")).toContainText("3 of 14 days match");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `/tmp/aer-calm-markers-${viewport.width}.png`, fullPage: true });
    calmWind = true;
    await page.getByRole("button", { name: "Refresh forecast", exact: true }).click();
    await expect(page.locator(".history-forecast-heading")).toContainText("4 of 14 days match");
    await expect(page.locator(".history-forecast-windows li").first()).toContainText("06:00–10:00");
    await expect(page.locator(".history-forecast-windows > li").first().locator(".forecast-window-wind")).toContainText("1.8 km/h · S");
    await expect(page.locator(".history-forecast-windows > li").nth(1).locator(".forecast-window-wind")).toContainText("1.8 km/h · S / N");
    await page.getByRole("button", { name: "Close history" }).click();
    await open("Nearshore wind");
    await expect(page.getByLabel("Swell height from")).toBeHidden();
    const calm = page.getByLabel("Wind direction ignored at or below");
    await expect(calm).toHaveValue("2");
    await calm.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/aer-calm-wind-editor-${viewport.width}.png`, fullPage: true });
    await page.getByLabel("Marker type").selectOption("both");
    await expect(page.getByLabel("Swell height from")).toBeVisible();
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    await expect(page.locator(".saved-spot-both")).toHaveText("W+S");
    await page.getByLabel("Marker type").selectOption("wind");
    await calm.fill("0"); await calm.press("Tab");
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    await expect(page.locator(".saved-spot-wind")).toHaveText("W");
    await page.getByRole("button", { name: "Close history" }).click();
    await open("Offshore swell");
    await expect(page.locator(".history-forecast-heading")).toContainText("3 of 14 days match");
    await page.getByRole("button", { name: "Close history" }).click();
    await open("Nearshore wind");
    await expect(calm).toHaveValue("0");
    await calm.fill("2"); await calm.press("Tab");
    await page.getByLabel("Matching days for rule 1").fill("4");
    await page.getByLabel("Matching days for rule 1").press("Tab");
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    await page.getByRole("button", { name: "Close history" }).click();
    await open("Offshore swell");
    await expect(page.locator(".history-forecast-heading")).toContainText("Your alert threshold is not met yet.");
    await expect(page.locator(".history-linked-results")).toContainText("Nearshore wind: Not met");
    await page.getByRole("button", { name: "Close history" }).click();
    await page.locator(".saved-spot-wind").click({ position: { x: 17, y: 6 } });
    await expect(page.getByLabel("Name this spot and season")).toHaveValue("Nearshore wind");
    await expect(page.getByRole("button", { name: /^Saved spots / })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Delete marker", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Find your season" })).toHaveCount(0);
    await expect(page.locator(".saved-spot-wind")).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".saved-spot-wind")).toHaveCount(0);
    await open("Offshore swell");
    await expect(page.locator(".history-linked-spots [role=alert]")).toContainText("A linked spot is missing");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots[0].linkedSpotIds), ["coast"]);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Linked points: ${viewport.width}px passed, including marker types, configurable calm-wind matching, shared hours and missing dependencies.`);
  }
} finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }

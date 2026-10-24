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
          : { wind_speed_10m: time.map(() => 3),
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
    await expect(page.getByLabel("Conditions to check at this point")).toHaveValue("swell");
    await expect(page.getByLabel("Wind speed at most")).toBeHidden();
    await expect(page.locator(".history-forecast-heading")).toContainText("4 of 14 days match");
    await page.locator(".history-linked-spots").getByLabel(/Nearshore wind/).check();
    await expect(page.locator(".history-forecast-heading")).toContainText("3 of 14 days match");
    await expect(page.locator(".history-forecast-heading")).toContainText("Your alert threshold is met.");
    await expect(page.locator(".history-linked-results")).toContainText("Nearshore wind: Met");
    await expect(page.locator(".history-forecast-windows li").first()).toContainText("08:00–10:00");
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    await page.getByRole("button", { name: "Close history" }).click();
    await expect(page.locator('path.saved-spot-link')).toHaveCount(1);
    await page.reload();
    await open("Offshore swell");
    await expect(page.locator(".history-linked-spots").getByLabel(/Nearshore wind/)).toBeChecked();
    await expect(page.locator(".history-forecast-heading")).toContainText("3 of 14 days match");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `/tmp/aer-linked-spots-${viewport.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Close history" }).click();
    await open("Nearshore wind");
    await expect(page.getByLabel("Swell height from")).toBeHidden();
    await page.getByLabel("Matching days for rule 1").fill("4");
    await page.getByLabel("Matching days for rule 1").press("Tab");
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    await page.getByRole("button", { name: "Close history" }).click();
    await open("Offshore swell");
    await expect(page.locator(".history-forecast-heading")).toContainText("Your alert threshold is not met yet.");
    await expect(page.locator(".history-linked-results")).toContainText("Nearshore wind: Not met");
    await page.getByRole("button", { name: "Close history" }).click();
    await page.getByRole("button", { name: /^Saved spots / }).click();
    await page.getByRole("button", { name: "Remove Nearshore wind", exact: true }).click();
    await page.locator(".saved-spot-open").filter({ hasText: "Offshore swell" }).click();
    await expect(page.locator(".history-linked-spots [role=alert]")).toContainText("A linked spot is missing");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots[0].linkedSpotIds), ["coast"]);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Linked points: ${viewport.width}px passed, including persistence, shared hours, independent rules and missing dependencies.`);
  }
} finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }

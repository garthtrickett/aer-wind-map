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
const date = "2025-10-24";
const time = Array.from({ length: 24 }, (_, hour) => Date.parse(`${date}T00:00:00+08:00`) / 1000 + hour * 3600);
const spot = { id: "jinzun", name: "Jinzun test marker", point: { latitude: 22.952, longitude: 121.295 },
  startYear: 2025, endYear: 2025, criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 2 };

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, timezoneId: "America/Los_Angeles" });
    await context.addInitScript((spot) => {
      localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [spot] }));
    }, spot);
    let failWaves = false, nullValues = false;
    const dayRequests: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/telegram/")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: {
          available: false, connected: false, pending: false, revision: 0, spotCount: 0, lastCheckedAt: null, lastSentAt: null, issue: null,
        } }) }); return;
      }
      if (url.hostname.endsWith("open-meteo.com")) {
        const day = url.searchParams.has("start_date") && url.searchParams.get("start_date") === url.searchParams.get("end_date");
        if (day) dayRequests.push(url.toString());
        const marine = url.hostname.startsWith("marine");
        if (day && failWaves && marine) { await route.fulfill({ status: 503, body: "unavailable" }); return; }
        const value = (n: number) => time.map(() => day && nullValues ? null : n);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ latitude: 22.9583, longitude: 121.375,
          timezone: "Asia/Taipei", hourly: { time,
            ...(marine ? { swell_wave_height: value(1.2), swell_wave_period: value(8), swell_wave_direction: value(65),
              wave_height: value(1.7), wave_period: value(6), wave_direction: value(75) }
              : { wind_speed_10m: value(day ? 3.6 : 1), wind_direction_10m: value(355) }) } }) }); return;
      }
      if (url.origin === new URL(base).origin) await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByRole("button", { name: /^Saved spots / }).click();
    await page.locator(".saved-spot-open").filter({ hasText: spot.name }).click();
    await page.getByRole("button", { name: "Look up a day" }).click();
    await expect(page.getByLabel("Lookup start hour")).toHaveValue("6");
    await expect(page.getByLabel("Lookup end hour")).toHaveValue("18");
    assert.equal(dayRequests.length, 0, "Opening the lookup must not download history automatically");
    await page.getByLabel("Lookup date").fill(date);
    await page.getByRole("button", { name: "Load day", exact: true }).click();
    await expect(page.locator(".day-lookup-status")).toContainText("Asia/Taipei · 12 hourly records");
    await expect(page.locator(".day-lookup-table tbody tr")).toHaveCount(12);
    const first = page.locator(".day-lookup-table tbody tr").first();
    await expect(first).toContainText("06:00");
    await expect(first).toContainText("3.6 km/h");
    await expect(first).toContainText("N 355°");
    await expect(first).toContainText("1.2 m · 8.0 s");
    await expect(first).toContainText("1.7 m · 6.0 s");
    await expect(page.locator(".day-lookup-content")).toContainText("22.9583, 121.3750");
    assert.equal(dayRequests.length, 2);
    await page.getByLabel("Lookup end hour").selectOption("9");
    await expect(page.locator(".day-lookup-table tbody tr")).toHaveCount(3);
    assert.equal(dayRequests.length, 2, "Hour filters must reuse the downloaded day");
    await page.getByLabel("Lookup start hour").selectOption("0");
    await page.getByLabel("Lookup end hour").selectOption("24");
    await expect(page.locator(".day-lookup-table tbody tr")).toHaveCount(24);
    await page.getByLabel("Lookup start hour").selectOption("6");
    await page.getByLabel("Lookup end hour").selectOption("9");
    await page.screenshot({ path: `/tmp/aer-day-lookup-${viewport.width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

    failWaves = true;
    await page.getByRole("button", { name: "Load day", exact: true }).click();
    await expect(page.locator(".day-lookup-warning")).toContainText("Waves: Source unavailable");
    await expect(page.locator(".day-lookup-table tbody tr").first()).toContainText("3.6 km/h");
    await expect(page.locator(".day-lookup-table tbody tr").first()).not.toContainText("1.7 m");
    failWaves = false; nullValues = true;
    await page.getByRole("button", { name: "Load day", exact: true }).click();
    await expect(page.locator(".day-lookup-warning")).toContainText("No usable values");
    await expect(page.locator(".day-lookup-table tbody tr").first()).not.toContainText("0.0");

    await page.getByLabel("Lookup date").fill("2025-10-25");
    await expect(page.locator(".day-lookup-table")).toHaveCount(0);
    await page.getByRole("button", { name: "Close history" }).click();
    await page.getByRole("button", { name: "Open forecast details" }).click();
    await expect(page.getByRole("button", { name: "Look up a day" })).toHaveAttribute("aria-expanded", "true");
    nullValues = false;
    await page.getByRole("button", { name: "Load day", exact: true }).click();
    // The fixture times belong to the previous date: the loader must not relabel them.
    await expect(page.locator(".day-lookup-status")).toContainText("0 hourly records");
    await page.getByLabel("Lookup date").fill(date);
    await page.getByRole("button", { name: "Load day", exact: true }).click();
    await expect(page.locator(".day-lookup-table tbody tr")).toHaveCount(3);
    await page.screenshot({ path: `/tmp/aer-day-details-${viewport.width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log(`Daily lookup passed at ${viewport.width}px: local hours, units, filters, partial source, missing data and both marker panels.`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

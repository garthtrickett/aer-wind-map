import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
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
const output = await mkdtemp(join(tmpdir(), "aer-swell-distribution-"));
const spot: SavedSpot = { id: "distribution-fixture", name: "Beach swell combinations",
  point: { latitude: -8.7, longitude: 115.1 }, startYear: 2025, endYear: 2025,
  criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 2 };
const time = ["2025-01-01", "2025-02-01", "2025-04-01"].flatMap((day) =>
  Array.from({ length: 24 }, (_, hour) => Date.parse(`${day}T00:00:00Z`) / 1000 + hour * 3600));
const aprilWind: Record<number, { speed: number | null; direction: number | null }> = {
  6: { speed: 0, direction: null }, 7: { speed: 1.9 / 3.6, direction: null },
  8: { speed: 2 / 3.6, direction: 45 }, 9: { speed: 5 / 3.6, direction: 45 },
  10: { speed: 10 / 3.6, direction: 45 }, 11: { speed: 15 / 3.6, direction: 45 },
  12: { speed: 20 / 3.6, direction: 45 }, 13: { speed: 3, direction: null },
  14: { speed: null, direction: 45 }, 15: { speed: 5 / 3.6, direction: 359 },
  16: { speed: 10 / 3.6, direction: 45 }, 17: { speed: 10 / 3.6, direction: 270 },
};

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript((spot) => localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [spot] })), spot);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/account/session") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false, emailEnabled: false,
          user: null, spots: [], revision: 0, importedSources: [] }) }); return;
      }
      if (url.pathname.startsWith("/v1/") && url.searchParams.has("start_date")) {
        const marine = url.hostname.startsWith("marine-");
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ latitude: -8.7, longitude: 115.1,
          timezone: "UTC", hourly: { time, ...(marine ? {
            swell_wave_height: time.map((_, i) => i % 24 === 9 ? .2 : i % 24 >= 14 ? 2.2 : 1),
            swell_wave_period: time.map((_, i) => i % 24 < 8 ? 5 : i % 24 < 10 ? 7 : i % 24 < 14 ? 15 : 11),
            swell_wave_direction: time.map(() => 220),
          } : { wind_speed_10m: time.map((_, i) => i < 48 ? 3 : aprilWind[i % 24]?.speed ?? null),
            wind_direction_10m: time.map((_, i) => i < 48 ? (i < 24 && i % 4 < 2 ? 90 : 270) :
              aprilWind[i % 24]?.direction ?? null) }) } }) }); return;
      }
      if (url.origin === new URL(base).origin && !url.pathname.startsWith("/api/")) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByRole("button", { name: /^Saved spots / }).click();
    await page.locator(".saved-spot-open").click();
    const grid = page.locator(".swell-distribution");
    const wind = page.locator(".wind-distribution");
    await expect(wind).toContainText("January wind direction × speed");
    await expect(wind.locator("tbody td")).toHaveCount(48);
    await expect(wind.getByRole("columnheader", { name: "All speeds" })).toBeVisible();
    const directionTotals = wind.locator("tbody .distribution-total");
    await expect(directionTotals).toHaveText(["0%", "0%", "50%", "0%", "0%", "0%", "50%", "0%"]);
    await expect(wind.locator("tbody tr").nth(2).locator("td").nth(2)).toHaveText("50%");
    await expect(wind.locator("tbody tr").nth(6).locator("td").nth(2)).toHaveText("50%");
    await expect(wind).toContainText("Calm (<2 km/h): 0%");
    await expect(grid).toContainText("January swell height × period");
    await expect(grid.locator("thead th").nth(1)).toHaveText("<6 s");
    await expect(grid.locator("thead th").nth(2)).toHaveText("6–8 s");
    await expect(grid.locator(".distribution-subtitle")).toHaveText("with good wind");
    await expect(grid.locator("tbody td")).toHaveCount(35);
    const row = grid.locator("tbody tr").nth(1);
    await expect(row.locator("td").nth(1)).toHaveText("8.3%");
    await expect(row.locator("td").nth(5)).toHaveText("16.7%");
    await expect(grid).toContainText("Good wind during 50%");
    await expect(grid).toContainText("12 of 372 possible hourly samples available");
    const totals = grid.locator("tfoot td");
    await expect(grid.locator("tfoot th")).toHaveText("All heights");
    // Sum raw observations across height bands before rounding: 8.3% + 8.3% displays as 16.7%.
    await expect(totals).toHaveText(["0%", "16.7%", "0%", "16.7%", "0%", "16.7%", "0%"]);
    await grid.scrollIntoViewIfNeeded();
    const tableRegion = grid.getByRole("region", { name: "Swell height and period table" });
    const box = await tableRegion.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width, "grid fits viewport");
    await tableRegion.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(grid.locator("thead th").last()).toBeInViewport();
    await tableRegion.evaluate((element) => { element.scrollLeft = 0; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await grid.screenshot({ path: join(output, `combined-${width}.png`) });
    await page.getByRole("button", { name: "Show February qualifying days" }).click();
    await expect(grid).toContainText("February swell height × period");
    await expect(grid).toContainText("No hours passed your wind settings");
    await expect(totals).toHaveText(Array(7).fill("0%"));
    await expect(wind).toContainText("February wind direction × speed");
    await expect(wind.locator("tbody tr").nth(6).locator("td").nth(2)).toHaveText("100%");
    await expect(directionTotals).toHaveText(["0%", "0%", "0%", "0%", "0%", "0%", "100%", "0%"]);
    await page.getByRole("button", { name: "Show March qualifying days" }).click();
    await expect(wind).toContainText("No usable wind data for this month");
    await expect(directionTotals).toHaveCount(0);
    await expect(grid).toContainText("No usable paired swell and wind data");
    await expect(totals).toHaveCount(0);
    await page.getByLabel("Swell period at least").fill("20");
    await page.getByLabel("Swell period at least").press("Tab");
    await expect(grid).toContainText("March swell height × period");
    await page.getByRole("button", { name: "Show January qualifying days" }).click();
    await expect(row.locator("td").nth(1)).toHaveText("8.3%", { timeout: 10_000 });
    await page.getByLabel("Marker type").selectOption("swell");
    await expect(grid.locator(".distribution-subtitle")).toHaveCount(0);
    await expect(wind).toHaveCount(0);
    await expect(row.locator("td").nth(0)).toHaveText("16.7%");
    await expect(row.locator("td").nth(1)).toHaveText("8.3%");
    await expect(row.locator("td").nth(5)).toHaveText("33.3%");
    await expect(grid).toContainText("Most common combinations");
    await expect(totals).toHaveText(["16.7%", "16.7%", "0%", "33.3%", "0%", "33.3%", "0%"]);
    await page.getByLabel("Marker type").selectOption("wind");
    await expect(grid).toHaveCount(0);
    await expect(wind).toContainText("January wind direction × speed");
    await page.getByRole("button", { name: "Show April qualifying days" }).click();
    await expect(wind).toContainText("Calm (<2 km/h): 20%");
    await expect(wind).toContainText("10 of 360 possible hourly samples available");
    await expect(wind.locator("tbody tr").nth(1).locator("td").nth(2)).toHaveText("20%");
    await expect(directionTotals).toHaveText(["10%", "60%", "0%", "0%", "0%", "0%", "10%", "0%"]);
    await expect(wind.locator(".distribution-common li").first()).toContainText("NE at 10–15 km/h");
    await wind.scrollIntoViewIfNeeded();
    const windBox = await wind.locator("table").boundingBox();
    assert.ok(windBox && windBox.x >= 0 && windBox.x + windBox.width <= width, "wind table fits viewport");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await wind.screenshot({ path: join(output, `wind-${width}.png`) });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify({ viewports: [1440, 390, 320], jointWindPercent: 50, swellOnlyPercent: 100,
    monthSelection: true, missingData: true, errors: [], screenshots: output }));
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

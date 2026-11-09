import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";
import { decodeEcwam } from "../scripts/wave-history/netcdf.ts";
import type { SavedSpot } from "../src/saved-spots.ts";
const root = resolve("dist");
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" } as Record<string, string>)[extname(file)] ?? "application/octet-stream");
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const output = await mkdtemp(join(tmpdir(), "aer-ecwam-smoke-"));
const fixture = decodeEcwam(await readFile("tests/fixtures/ecwam/november-2025-taiwan.nc"), 2025, 11, 23.25, 122.5);
const spot: SavedSpot = { id: "ecwam-fixture", name: "Taiwan ECMWF", point: { latitude: 23.36, longitude: 122.42 },
  startYear: 2025, endYear: 2025, historyWaveSource: "ecwam", historySwellPartition: "primary",
  criteria: { ...defaultHistoryCriteria, conditions: "swell", minSwellPeriod: 9 }, alertEnabled: false, alertMinDays: 1 };
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    await context.addInitScript((spot) => localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [spot] })), spot);
    let posts = 0;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/account/session") {
        await route.fulfill({ json: { available: false, emailEnabled: false, user: null, spots: [], revision: 0, importedSources: [] } }); return;
      }
      if (url.pathname === "/api/wave-history") {
        if (route.request().method() === "POST") {
          posts++; await route.fulfill({ status: 401, json: { error: "Sign in to prepare new ECMWF history." } }); return;
        }
        await route.fulfill({ json: { progress: { configured: true, total: 13, ready: 1, pending: 0, missing: 12, failed: 0, active: null, error: null },
          ...(url.searchParams.get("data") === "1" ? { months: [fixture] } : {}) } }); return;
      }
      if (url.hostname === "archive-api.open-meteo.com") {
        await route.fulfill({ json: { latitude: 23.36, longitude: 122.42, timezone: "Asia/Taipei", hourly: {
          time: fixture.hours.map((hour) => hour.time), wind_speed_10m: fixture.hours.map(() => 1), wind_direction_10m: fixture.hours.map(() => 45),
        } } }); return;
      }
      if (url.origin === base && !url.pathname.startsWith("/api/")) await route.continue(); else await route.abort();
    });
    const page = await context.newPage(); const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByRole("button", { name: /^Saved spots / }).click(); await page.locator(".saved-spot-open").click();
    // A restored saved marker must select the correct source on its first render.
    await expect(page.locator('.wave-history-source select').nth(0)).toHaveValue("ecwam");
    await expect(page.locator('.wave-history-source')).toContainText("1/13 UTC months cached");
    await page.getByRole("button", { name: "Show November qualifying days" }).click();
    await expect(page.locator(".swell-distribution caption")).toContainText("Primary swell");
    await expect(page.locator(".history-source")).toContainText("CY50R1");
    assert.equal(posts, 0, "Opening or changing source must not submit archive downloads");
    await page.getByLabel("Swell component", { exact: true }).selectOption("secondary");
    await expect(page.locator(".swell-distribution caption")).toContainText("Secondary swell");
    await page.getByRole("button", { name: "Update saved spot", exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots[0]);
    assert.equal(saved.historySwellPartition, "secondary");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download hourly CSV" }).click();
    const download = await downloadEvent; const path = await download.path(); assert.ok(path);
    assert.match(await readFile(path, "utf8"), /ECMWF_ECWAM_CY50R1_hindcast,secondary,Tm-1_0/);
    await page.getByRole("button", { name: "Prepare missing ECMWF history" }).click();
    await expect(page.locator(".history-message[role=alert]")).toContainText("Sign in to prepare");
    assert.equal(posts, 1);
    // Source controls and message must stay inside their parent on narrow screens.
    const geometry = await page.locator(".wave-history-source").evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(geometry.scroll <= geometry.width + 2, JSON.stringify({ width, geometry }));
    await page.locator(".wave-history-source").screenshot({ path: join(output, `ecwam-${width}.png`) });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`ECWAM browser checks passed at 1440, 390 and 320 px. Screenshots: ${output}`);
} finally { await browser.close(); await new Promise<void>((done) => server.close(() => done())); }

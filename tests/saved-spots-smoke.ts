import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";

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
const browser = await chromium.launch({ headless: true });

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(base)).ok; } catch { /* Static server is starting. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Preview server did not start");

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const start = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 1000;
  const time = Array.from({ length: 15 * 24 }, (_, index) => start + index * 3600);
  const hourly = (fields: Record<string, number[]>): object => ({ timezone: "UTC", hourly: { time, ...fields } });
  const wave = hourly({ swell_wave_height: time.map(() => 2), swell_wave_period: time.map(() => 12),
    swell_wave_direction: time.map(() => 220) });
  const wind = hourly({ wind_speed_10m: time.map(() => 3),
    wind_direction_10m: time.map((_, index) => [2, 4].includes(Math.floor(index / 24)) ? 90 : 180) });
  const historicalTime = Array.from({ length: 24 }, (_, index) => Date.parse("2025-01-01T00:00:00Z") / 1000 + index * 3600);
  const archiveRequests: string[] = [];
  await page.route("**/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("forecast_days=15") && url.includes("models=ncep_gfswave025")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(wave) });
    } else if (url.includes("forecast_days=15") && url.includes("models=ecmwf_ifs")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(wind) });
    } else if (url.includes("models=meteofrance_wave") || url.includes("archive-api.open-meteo.com")) {
      archiveRequests.push(url);
      const marine = url.includes("marine-api");
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        latitude: -8.75, longitude: 115, timezone: "UTC", hourly: { time: historicalTime,
          ...(marine ? { swell_wave_height: historicalTime.map(() => 2), swell_wave_period: historicalTime.map(() => 12),
            swell_wave_direction: historicalTime.map(() => 220) }
            : { wind_speed_10m: historicalTime.map(() => 3), wind_direction_10m: historicalTime.map(() => 90) }) },
      }) });
    } else await route.continue();
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#map").click({ position: { x: 430, y: 450 } });
  await page.getByRole("button", { name: "Open forecast details" }).click();
  await page.getByRole("button", { name: /Explore historical swell and wind/ }).click();
  const maximumPeriod = page.getByLabel("Swell period at most");
  const minimumPeriod = page.getByLabel("Swell period at least");
  await expect(maximumPeriod).toHaveValue("");
  await expect(page.locator(".history-month").first()).toContainText("1/1 days");
  await maximumPeriod.fill("11");
  await maximumPeriod.press("Tab");
  await expect(page.locator(".history-month").first()).toContainText("0/1 days");
  await minimumPeriod.fill("13");
  await minimumPeriod.press("Tab");
  await expect(maximumPeriod).toHaveValue("13");
  await maximumPeriod.fill("12");
  await maximumPeriod.press("Tab");
  await expect(minimumPeriod).toHaveValue("12");
  await expect(page.locator(".history-month").first()).toContainText("1/1 days");
  assert.equal(archiveRequests.length, 2, "period changes should rescore downloaded history");
  await page.getByLabel("Name this spot and season").fill("Wet season Bukit");
  await page.locator(".history-alert-option input").check();
  await page.getByLabel("Alert when at least").fill("2");
  await page.getByLabel("Alert when at least").press("Tab");
  await page.getByRole("button", { name: "Save spot", exact: true }).click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("aer.saved-spots.v1");
    return raw && JSON.parse(raw).spots[0]?.alertMinDays === 2;
  });
  await page.locator(".forecast-alert-list button").waitFor({ timeout: 20_000 });
  assert.match(await page.locator(".forecast-alert-list button").innerText(), /2 of 14 days/);
  assert.equal(await page.locator(".saved-spot-icon").count(), 1);
  await page.getByRole("button", { name: "Close history" }).click();
  await page.locator(".saved-spot-icon").click();
  assert.equal(await page.getByLabel("Name this spot and season").inputValue(), "Wet season Bukit");
  assert.equal(await page.getByLabel("Alert when at least").inputValue(), "2");
  await expect(maximumPeriod).toHaveValue("12");
  await maximumPeriod.fill("11");
  await maximumPeriod.press("Tab");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  await expect(page.locator(".forecast-alert-list button")).toHaveCount(0);
  await maximumPeriod.fill("");
  await maximumPeriod.press("Tab");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  await expect(page.locator(".forecast-alert-list button")).toContainText("2 of 14 days");
  await maximumPeriod.fill("12");
  await maximumPeriod.press("Tab");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  await page.getByRole("button", { name: "Close history" }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator(".saved-spot-icon").count(), 1);
  await page.getByRole("button", { name: /Saved spots 1/ }).click();
  await page.locator(".saved-spot-open").click();
  await expect(maximumPeriod).toHaveValue("12");
  assert.equal(await page.getByLabel("Name this spot and season").inputValue(), "Wet season Bukit");
  await page.getByLabel("Name this spot and season").fill("Dry season Bukit");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  assert.equal(await page.locator(".saved-spot-icon").count(), 1);
  await page.getByRole("button", { name: "Save as new" }).click();
  assert.equal(await page.locator(".saved-spot-icon").count(), 2);
  await page.getByRole("button", { name: "Close history" }).click();
  await page.getByRole("button", { name: /Saved spots 2/ }).click();
  await page.getByRole("button", { name: "Remove Dry season Bukit" }).first().click();
  assert.equal(await page.locator(".saved-spot-icon").count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ savedSpots: 1, matchingDays: 2, errors }));
} finally {
  await browser.close();
  server?.kill();
}

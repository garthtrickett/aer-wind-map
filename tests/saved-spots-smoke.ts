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
  const hourly = (fields: Record<string, (number | null)[]>): object => ({ timezone: "UTC", hourly: { time, ...fields } });
  const wave = hourly({ swell_wave_height: time.map(() => 2), swell_wave_period: time.map(() => 12),
    swell_wave_direction: time.map(() => 220) });
  const wind = hourly({ wind_speed_10m: time.map(() => 3),
    wind_direction_10m: time.map((_, index) => [7, 10, 12, 13].includes(Math.floor(index / 24)) ? 90 : 180) });
  const historicalTime = Array.from({ length: 24 }, (_, index) => Date.parse("2025-01-01T00:00:00Z") / 1000 + index * 3600);
  const archiveRequests: string[] = [];
  let forecastRequests = 0;
  let responseMode: "normal" | "network" | "empty" | "short" = "normal";
  let releasePreview!: () => void;
  let holdPreview = true;
  const previewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
  await page.route("**/v1/**", async (route) => {
    const url = route.request().url();
    if (new URL(url).searchParams.has("forecast_days")) {
      forecastRequests++;
      if (holdPreview) await previewGate;
      const marine = url.includes("models=meteofrance_wave");
      assert.equal(new URL(url).searchParams.get("forecast_days"), marine ? "10" : "15");
      if (responseMode === "network") await route.fulfill({ status: 503, body: "Unavailable" });
      else await route.fulfill({ contentType: "application/json", body: JSON.stringify(marine
        ? responseMode === "empty" ? hourly({ swell_wave_height: time.map(() => null),
          swell_wave_period: time.map(() => 12), swell_wave_direction: time.map(() => 220) })
          : responseMode === "short" ? { timezone: "UTC", hourly: {
            time: time.slice(0, 240), swell_wave_height: time.slice(0, 240).map(() => 2),
            swell_wave_period: time.slice(0, 240).map(() => 12), swell_wave_direction: time.slice(0, 240).map(() => 220),
          } } : wave : wind) });
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
  // The compass loads its two sources independently of the opted-in alert preview.
  const compassRequests = 2;
  await expect.poll(() => forecastRequests).toBe(compassRequests);
  await page.getByLabel("Name this spot and season").fill("Wet season Bukit");
  await page.locator(".history-alert-option input").check();
  await page.getByLabel("Matching days for rule 1").fill("2");
  await page.getByLabel("Matching days for rule 1").press("Tab");
  const preview = page.locator(".history-forecast-preview");
  await expect(preview).toContainText("Checking the next 14 days");
  assert.equal(await page.evaluate(() => localStorage.getItem("aer.saved-spots.v1")), null, "draft checks do not require saving");
  holdPreview = false;
  releasePreview();
  await expect(preview).toContainText("4 of 14 days match");
  await expect(preview).toContainText("Météo-France MFWAM primary swell + ECMWF IFS wind");
  await expect(preview).toContainText("up to 10 days; later days are unknown");
  await expect(preview).toContainText("Your alert threshold is met");
  await expect(preview.locator(".history-forecast-windows li")).toHaveCount(4);
  await expect(preview.locator(".history-forecast-windows li").first()).toContainText("06:00–18:00");
  assert.equal(forecastRequests, compassRequests + 2);
  await maximumPeriod.fill("11");
  await maximumPeriod.press("Tab");
  await expect(preview).toContainText("0 of 14 days match");
  await expect(preview).toContainText("No days match your current conditions");
  await maximumPeriod.fill("12");
  await maximumPeriod.press("Tab");
  await page.getByLabel("Matching days for rule 1").fill("5");
  await page.getByLabel("Matching days for rule 1").press("Tab");
  await expect(preview).toContainText("4 of 14 days match");
  await expect(preview).toContainText("Your alert threshold is not met yet");
  assert.equal(forecastRequests, compassRequests + 2, "condition and day-threshold edits reuse downloaded forecasts");
  await page.getByLabel("Matching days for rule 1").fill("2");
  await page.getByLabel("Matching days for rule 1").press("Tab");
  const lookAhead = page.getByLabel("Forecast look-ahead days");
  await expect(lookAhead).toHaveValue("14");
  const totalDays = page.getByLabel("Total days for rule 1");
  await totalDays.fill("4");
  await totalDays.press("Tab");
  await expect(preview).toContainText("Rule 1: 3 matching days in a 4-day period (need 2)");
  await expect(preview).toContainText("Your alert threshold is met");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Total days for rule 2").fill("7");
  await page.getByLabel("Total days for rule 2").press("Tab");
  await page.getByLabel("Matching days for rule 2").fill("4");
  await page.getByLabel("Matching days for rule 2").press("Tab");
  await expect(preview).toContainText("Rule 2: 4 matching days in a 7-day period (need 4)");
  await page.getByLabel("Matching days for rule 1").fill("4");
  await page.getByLabel("Matching days for rule 1").press("Tab");
  await expect(preview).toContainText("Your alert threshold is met"); // second rule alone
  await page.getByLabel("Matching days for rule 2").fill("5");
  await page.getByLabel("Matching days for rule 2").press("Tab");
  await expect(preview).toContainText("Your alert threshold is not met yet");
  await page.getByLabel("Matching days for rule 1").fill("2");
  await page.getByLabel("Matching days for rule 1").press("Tab");
  await expect(preview).toContainText("Your alert threshold is met"); // first rule alone
  await page.getByLabel("Matching days for rule 2").fill("4");
  await page.getByLabel("Matching days for rule 2").press("Tab");
  await lookAhead.fill("7");
  await lookAhead.press("Tab");
  await expect(preview).toContainText("0 of 7 days match");
  await expect(preview).toContainText("Your alert threshold is not met yet");
  await expect(totalDays).toHaveValue("4");
  await expect(page.getByLabel("Total days for rule 2")).toHaveValue("7");
  await lookAhead.fill("14");
  await lookAhead.press("Tab");
  await expect(preview).toContainText("4 of 14 days match");
  await expect(preview).toContainText("Your alert threshold is met");
  assert.equal(forecastRequests, compassRequests + 2, "sliding rules and look-ahead reuse the same downloaded hours");
  responseMode = "network";
  await page.getByRole("button", { name: "Refresh forecast", exact: true }).click();
  await expect(preview).toContainText("The forecast could not be loaded");
  responseMode = "empty";
  await page.getByRole("button", { name: "Retry forecast", exact: true }).click();
  await expect(preview).toContainText("No usable forecast is available for all selected conditions");
  responseMode = "short";
  await page.getByRole("button", { name: "Retry forecast", exact: true }).click();
  await expect(preview).toContainText("1 of 14 days match");
  await expect(preview).toContainText("The remaining days are unknown");
  await expect(preview).toContainText("Your alert threshold is not met yet");
  responseMode = "normal";
  await page.getByRole("button", { name: "Refresh forecast", exact: true }).click();
  await expect(preview).toContainText("4 of 14 days match");
  await preview.screenshot({ path: "/tmp/aer-sliding-alerts-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.scrollIntoViewIfNeeded();
  const box = await preview.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, "forecast results fit the mobile viewport");
  await preview.screenshot({ path: "/tmp/aer-sliding-alerts-mobile.png" });
  const editor = page.locator(".history-alert-rules");
  await editor.scrollIntoViewIfNeeded();
  const editorBox = await editor.boundingBox();
  assert.ok(editorBox && editorBox.x >= 0 && editorBox.x + editorBox.width <= 390, "alert rule inputs fit the mobile viewport");
  await editor.screenshot({ path: "/tmp/aer-sliding-alerts-editor-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Save spot", exact: true }).click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("aer.saved-spots.v1");
    return raw && JSON.parse(raw).spots[0]?.alertMinDays === 2;
  });
  await page.locator(".forecast-alert-list button").waitFor({ timeout: 20_000 });
  assert.match(await page.locator(".forecast-alert-list button").innerText(), /4 of 14 days/);
  assert.equal(await page.locator(".saved-spot-icon").count(), 1);
  await page.getByRole("button", { name: "Close history" }).click();
  await page.locator(".saved-spot-icon").click();
  assert.equal(await page.getByLabel("Name this spot and season").inputValue(), "Wet season Bukit");
  assert.equal(await page.getByLabel("Matching days for rule 1").inputValue(), "2");
  await expect(totalDays).toHaveValue("4");
  await expect(page.getByLabel("Total days for rule 2")).toHaveValue("7");
  await expect(maximumPeriod).toHaveValue("12");
  await maximumPeriod.fill("11");
  await maximumPeriod.press("Tab");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  await expect(page.locator(".forecast-alert-list button")).toHaveCount(0);
  await maximumPeriod.fill("");
  await maximumPeriod.press("Tab");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  await expect(page.locator(".forecast-alert-list button")).toContainText("4 of 14 days");
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
  await expect(lookAhead).toHaveValue("14");
  await expect(totalDays).toHaveValue("4");
  await expect(page.getByLabel("Total days for rule 2")).toHaveValue("7");
  await page.getByLabel("Matching days for rule 1").fill("4");
  await page.getByLabel("Matching days for rule 1").press("Tab");
  await page.getByRole("button", { name: "Remove alert rule 2", exact: true }).click();
  await expect(page.locator(".history-alert-rule")).toHaveCount(1);
  await expect(preview).toContainText("Your alert threshold is not met yet");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Total days for rule 2").fill("1");
  await page.getByLabel("Total days for rule 2").press("Tab");
  await expect(page.getByLabel("Matching days for rule 2")).toHaveValue("1");
  await page.getByLabel("Total days for rule 2").fill("7");
  await page.getByLabel("Total days for rule 2").press("Tab");
  await page.getByLabel("Matching days for rule 2").fill("2");
  await page.getByLabel("Matching days for rule 2").press("Tab");
  await expect(preview).toContainText("Your alert threshold is met");
  await page.getByLabel("Matching days for rule 1").fill("2");
  await page.getByLabel("Matching days for rule 1").press("Tab");
  await page.getByLabel("Matching days for rule 2").fill("4");
  await page.getByLabel("Matching days for rule 2").press("Tab");
  await lookAhead.fill("12");
  await lookAhead.press("Tab");
  await page.getByLabel("Name this spot and season").fill("Dry season Bukit");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  assert.equal(await page.locator(".saved-spot-icon").count(), 1);
  await page.getByRole("button", { name: "Save as new" }).click();
  assert.equal(await page.locator(".saved-spot-icon").count(), 2);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots.every((spot: { alertLookAheadDays: number }) => spot.alertLookAheadDays === 12)), true);
  await page.getByRole("button", { name: "Close history" }).click();
  await page.getByRole("button", { name: /Saved spots 2/ }).click();
  await page.getByRole("button", { name: "Remove Dry season Bukit" }).first().click();
  assert.equal(await page.locator(".saved-spot-icon").count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ savedSpots: 1, matchingDays: 4, errors }));
} finally {
  await browser.close();
  server?.kill();
}

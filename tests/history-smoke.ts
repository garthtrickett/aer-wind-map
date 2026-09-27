import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, firefox, webkit } from "@playwright/test";

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
const engine = process.env.BROWSER === "firefox" ? firefox : process.env.BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch({ headless: true });

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(base)).ok; } catch { /* Static server is starting. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Preview server did not start");
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors: string[] = [];
  const archiveRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("open-meteo.com/v1/")) archiveRequests.push(request.url());
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#map").click({ position: { x: 430, y: 450 } });
  await page.getByRole("button", { name: "Open forecast details" }).click();
  await page.getByRole("button", { name: /Explore historical swell and wind/ }).click();
  try {
    await page.locator(".history-month").first().waitFor({ timeout: 60_000 });
  } catch (error) {
    console.error(await page.locator(".history-panel").innerText());
    throw error;
  }
  assert.equal(await page.locator(".history-month").count(), 12);
  assert.deepEqual(await page.locator(".history-settings select").evaluateAll((elements) => elements.map((element) => (element as HTMLSelectElement).value)),
    ["90", String(new Date().getUTCFullYear() - 3), String(new Date().getUTCFullYear() - 1)]);
  assert.ok((await page.locator(".history-month").allInnerTexts()).some((text) => /\d+\/\d+ days/.test(text) && !text.includes("/0 days")));
  assert.ok((await page.locator(".history-coverage").innerText()).includes("Times are local to"));
  assert.equal(archiveRequests.length, 2);
  for (const [label, value] of [
    ["Swell height from", "0"], ["Swell height to", "15"], ["Swell period at least", "0"],
    ["Wind speed at most", "40"], ["Direction within", "180"],
  ]) {
    await page.getByLabel(label).fill(value);
    await page.getByLabel(label).press("Tab");
  }
  await page.getByLabel("Wind from").selectOption("180");
  assert.match(await page.locator(".history-best").innerText(), /\d+ of \d+ usable days/);
  assert.equal(archiveRequests.length, 2, "changing conditions should reuse the downloaded history");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download hourly CSV" }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^aer-history-\d{4}-\d{4}\.csv$/);
  const csvPath = await download.path();
  assert.ok(csvPath);
  const csv = await readFile(csvPath, "utf8");
  assert.ok(csv.startsWith("time_utc,local_day,swell_height_m,swell_period_s,wind_speed_ms,wind_from_degrees,meets_conditions\n"));
  assert.ok(csv.split("\n").length > 20_000);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: "/tmp/aer-history-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ months: 12, archiveRequests: archiveRequests.length, csvRows: csv.split("\n").length - 2, errors }));
} finally {
  await browser.close();
  server?.kill();
}

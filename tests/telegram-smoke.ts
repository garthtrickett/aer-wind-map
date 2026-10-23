import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createAlertHttp } from "../scripts/alerts/http.ts";
import { openAlertStore } from "../scripts/alerts/store.ts";
import { createMonitor } from "../scripts/alerts/monitor.ts";
import { forecastLookAhead } from "../src/alert-rules.ts";
import { forecastAlertKey } from "../src/forecast-alerts.ts";
import { defaultHistoryCriteria } from "../src/history.ts";
import type { SavedSpot } from "../src/saved-spots.ts";
import type { Telegram } from "../scripts/alerts/telegram.ts";

const directory = mkdtempSync(join(tmpdir(), "aer-telegram-browser-"));
const store = openAlertStore(join(directory, "alerts.sqlite"));
const browser = await chromium.launch({ headless: true });
let handler: ReturnType<typeof createAlertHttp>;
const root = resolve("dist");
const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/api/telegram/")) { await handler(request, response); return; }
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolve(root, path === "/" ? "index.html" : `.${path}`);
  if (!file.startsWith(root + "/")) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" } as Record<string, string>)[extname(file)] ?? "application/octet-stream");
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
handler = createAlertHttp({ store, username: "aer_test_bot", publicUrl: base });
const spot: SavedSpot = { id: "test-bukit", name: "Wet season Bukit", point: { latitude: -8.78, longitude: 115.07 },
  startYear: 2023, endYear: 2025, criteria: { ...defaultHistoryCriteria, maxSwellPeriod: 15 }, alertEnabled: true, alertMinDays: 2 };
const messages: string[] = [];
const links: string[] = [];
const telegram: Telegram = { identity: async () => "aer_test_bot", updates: async () => [],
  send: async (_id, text, url) => { messages.push(text); if (url) links.push(url); return { kind: "sent", messageId: messages.length }; } };
const monitor = createMonitor({ store, telegram, publicUrl: base, report: () => {}, load: async (spots) => spots.map((saved) => ({
  id: saved.id, key: forecastAlertKey(saved), ok: true, summary: {
    matchingDays: 2, availableDays: Math.min(13, forecastLookAhead(saved)), horizonDays: forecastLookAhead(saved), requiredHours: 2,
    nextWindowStart: Date.now() / 1000 + 86_400, timezone: "Asia/Makassar", checkedAt: Date.now(),
    windows: [1, 2].map((offset) => {
      const start = Math.floor(Date.now() / 1000) + offset * 86_400;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start * 1000));
      return { day, start, end: start + 7200 };
    }),
  },
})) });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript((saved) => {
    if (!localStorage.getItem("aer.saved-spots.v1")) localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots: [saved] }));
  }, spot);
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) { await route.continue(); return; }
    // This smoke tests settings and persistence; no live forecast download,
    // map tiles or real Telegram messages are necessary.
    await route.abort();
  });
  let page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("button", { name: /Saved spots 1/ }).click();
  await page.getByRole("button", { name: "Connect Telegram", exact: true }).click();
  const link = page.getByRole("link", { name: /Open Telegram and press Start/ });
  await expect(link).toBeVisible();
  const token = new URL((await link.getAttribute("href"))!).searchParams.get("start")!;
  store.applyUpdate({ update_id: 1, message: { message_id: 1, text: `/start ${token}`,
    chat: { id: 42, type: "private" }, from: { id: 42 } } }, Date.now());
  await page.getByRole("button", { name: "Refresh connection status" }).click();
  await expect(page.getByText(/Connected · 1 enabled spot/)).toBeVisible();
  await expect(page.getByText("Enabled saved spots synced. Checks continue with the app closed.")).toBeVisible();
  await page.close();
  await monitor.tick(); await monitor.tick();
  assert.equal(messages.filter((message) => message.includes("Forecast matches")).length, 1, "server sends with no Aer tab");
  await monitor.tick();
  assert.equal(messages.length, 2, "unchanged forecast must not duplicate notification");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await phone.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const newBrowser = await phone.newPage();
  await newBrowser.goto(links[0]);
  await expect(newBrowser.getByRole("heading", { name: "Find your season" })).toBeVisible();
  await expect(newBrowser.getByLabel("Swell period at most")).toHaveValue("15");
  assert.equal(await newBrowser.evaluate(() => localStorage.getItem("aer.saved-spots.v1")), null,
    "opening a link in a fresh browser must not silently save or enable alerts");
  await expect(newBrowser.locator(".history-alert-option input")).not.toBeChecked();
  assert.equal(new URL(newBrowser.url()).hash, "", "view capability must leave the address bar");
  await phone.close();
  page = await context.newPage();
  await page.goto(`${base}/?alert=${spot.id}`);
  await expect(page.getByRole("heading", { name: "Find your season" })).toBeVisible();
  await expect(page.getByLabel("Name this spot and season")).toHaveValue(spot.name);
  await expect(page.getByLabel("Swell period at most")).toHaveValue("15");
  await page.getByLabel("Swell period at most").fill("14");
  await page.getByLabel("Swell period at most").press("Tab");
  await expect(page.getByLabel("Forecast look-ahead days")).toHaveValue("14");
  await page.getByLabel("Forecast look-ahead days").fill("7");
  await page.getByLabel("Forecast look-ahead days").press("Tab");
  await page.getByLabel("Total days for rule 1").fill("4");
  await page.getByLabel("Total days for rule 1").press("Tab");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Total days for rule 2").fill("7");
  await page.getByLabel("Total days for rule 2").press("Tab");
  await page.getByRole("button", { name: "Update saved spot" }).click();
  await expect.poll(() => store.due(Date.now())[0]?.spot.criteria.maxSwellPeriod).toBe(14);
  await expect.poll(() => store.due(Date.now())[0]?.spot.alertLookAheadDays).toBe(7);
  await expect.poll(() => store.due(Date.now())[0]?.spot.alertRules).toEqual([
    { minDays: 2, withinDays: 4 }, { minDays: 2, withinDays: 7 },
  ]);
  await page.getByRole("button", { name: "Close history" }).click();
  await page.getByRole("button", { name: /Saved spots 1/ }).click();
  await expect(page.getByText(/Connected · 1 enabled spot/)).toBeVisible();
  await page.screenshot({ path: join(directory, "telegram-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Disconnect Telegram" }).click();
  await expect(page.getByRole("button", { name: "Connect Telegram", exact: true })).toBeVisible();
  assert.equal(store.due(Date.now()).length, 0);
  assert.deepEqual(errors, []);
  // Keep the screenshot in /tmp for review; remove only the test database.
  console.log(JSON.stringify({ closedTabAlert: true, duplicateSuppression: true, linkedSpotRestored: true,
    editedRulesSynced: true, freshPhoneBrowserReadOnlyLink: true, disconnected: true, screenshot: join(directory, "telegram-mobile.png") }));
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  for (const name of ["alerts.sqlite", "alerts.sqlite-wal", "alerts.sqlite-shm"]) rmSync(join(directory, name), { force: true });
}

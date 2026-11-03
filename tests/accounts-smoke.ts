import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createAccountHttp } from "../scripts/accounts/http.ts";
import { openAccountStore } from "../scripts/accounts/store.ts";
import { createAlertHttp } from "../scripts/alerts/http.ts";
import { defaultHistoryCriteria } from "../src/history.ts";
import type { SavedSpot } from "../src/saved-spots.ts";

const directory = mkdtempSync(join(tmpdir(), "aer-account-browser-"));
const store = openAccountStore(join(directory, "accounts.sqlite"));
const messages: { email: string; link: string }[] = [];
const root = resolve("dist");
let accountHttp: ReturnType<typeof createAccountHttp>;
const telegramHttp = createAlertHttp({ store: null, username: "", publicUrl: "" });
const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/api/account/")) { await accountHttp(request, response); return; }
  if (request.url?.startsWith("/api/telegram/")) { await telegramHttp(request, response); return; }
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
accountHttp = createAccountHttp({ store, publicUrl: base, mailer: async (email, link) => { messages.push({ email, link }); } });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const original: SavedSpot[] = [
  { id: "wind", name: "Canggu offshore wind", point: { latitude: -8.65, longitude: 115.13 }, startYear: 2022, endYear: 2025,
    criteria: { ...defaultHistoryCriteria, conditions: "wind" }, alertEnabled: false, alertMinDays: 2,
    linkedSpotIds: ["swell"], mapZoom: 13.75, shoreNormal: 219, alertRules: [{ minDays: 2, withinDays: 4 }] },
  { id: "swell", name: "Canggu offshore swell", point: { latitude: -8.88, longitude: 115.13 }, startYear: 2022, endYear: 2025,
    criteria: { ...defaultHistoryCriteria, conditions: "swell", minSwellPeriod: 9 }, alertEnabled: false, alertMinDays: 2 },
];
const context = async (width: number) => {
  const value = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500 });
  await value.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  value.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return value;
};
try {
  const first = await context(390);
  await first.addInitScript((spots) => {
    if (!/^https?:$/.test(location.protocol)) return;
    if (!localStorage.getItem("aer.saved-spots.v1")) localStorage.setItem("aer.saved-spots.v1", JSON.stringify({ version: 1, spots }));
  }, original);
  let page = await first.newPage();
  await page.goto(base);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
  await page.getByLabel("Email", { exact: true }).fill("garth@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(/Check your inbox/)).toBeVisible();
  assert.equal(messages.length, 1);
  await page.goto(messages[0].link);
  await expect(page.getByRole("button", { name: "Continue to Aer" })).toBeVisible();
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(store.session("not-a-session", Date.now()), null);
  await page.getByRole("button", { name: "Continue to Aer" }).click();
  const importButton = page.getByRole("button", { name: "Import this browser’s 2 spots" });
  await expect(importButton).toBeVisible();
  await expect(page.getByRole("button", { name: /^Saved spots 0/ })).toBeVisible();
  await importButton.click();
  await expect(page.getByText("Browser spots imported ✓")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Saved spots 2/ })).toBeVisible();
  const user = (await (await first.request.get(`${base}/api/account/session`)).json()).user;
  assert.deepEqual(store.data(user.id).spots, original);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots), original);
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: join(directory, "account-mobile.png"), fullPage: true });

  const second = await context(1440);
  const token = store.issueLink("garth@example.com", Date.now());
  const desktop = await second.newPage();
  await desktop.goto(`${base}/#login=${token}`);
  await desktop.getByRole("button", { name: "Continue to Aer" }).click();
  await expect(desktop.getByRole("button", { name: /^Saved spots 2/ })).toBeVisible();
  assert.equal(await desktop.evaluate(() => localStorage.getItem("aer.saved-spots.v1")), null);
  await desktop.locator(".saved-spot-open").filter({ hasText: "Canggu offshore wind" }).click();
  await expect(desktop.getByLabel("Name this spot and season")).toHaveValue("Canggu offshore wind");
  await desktop.getByLabel("Name this spot and season").fill("Canggu wind edited on desktop");
  await desktop.getByRole("button", { name: "Update saved spot", exact: true }).click();
  await expect(desktop.getByText("Saved to your account. Open it from Saved spots on any device.")).toBeVisible();
  assert.equal(store.data(user.id).spots.find((spot) => spot.id === "wind")!.name, "Canggu wind edited on desktop");
  assert.equal(store.data(user.id).spots.find((spot) => spot.id === "wind")!.mapZoom, 13.75);
  assert.equal(store.data(user.id).spots.find((spot) => spot.id === "wind")!.shoreNormal, 219);

  await page.reload();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.locator(".saved-spot-open").filter({ hasText: "Canggu wind edited on desktop" })).toBeVisible();
  await expect(page.getByText("Browser spots imported ✓")).toBeVisible();
  await expect(page.getByRole("button", { name: /Import this browser/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".saved-spot-open").filter({ hasText: "Canggu offshore wind" })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("aer.saved-spots.v1")!).spots), original);

  const otherToken = store.issueLink("connor@example.com", Date.now());
  await page.goto(`${base}/#login=${otherToken}`);
  await page.getByRole("button", { name: "Continue to Aer" }).click();
  await expect(page.getByRole("button", { name: /^Saved spots 0/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import this browser’s 2 spots" })).toBeVisible();
  assert.equal((await (await first.request.get(`${base}/api/account/session`)).json()).spots.length, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ magicLinkSignup: true, singleBrowserImport: true, originalPreserved: true,
    linkedSpotsPreserved: true, secondDeviceLoadsAndEdits: true, logoutRestoresGuestCopy: true,
    otherAccountIsolated: true, screenshot: join(directory, "account-mobile.png") }));
} finally {
  await browser.close(); server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  for (const name of ["accounts.sqlite", "accounts.sqlite-wal", "accounts.sqlite-shm"]) rmSync(join(directory, name), { force: true });
}

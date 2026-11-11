import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

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
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const output = await mkdtemp(join(tmpdir(), "aer-distance-"));
try {
  for (const viewport of [{ width: 1000, height: 760 }, { width: 390, height: 844 }]) {
    const touch = viewport.width < 500;
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.href === "https://tiles.openfreemap.org/styles/positron") return route.fulfill({ json: {
        version: 8, sources: {}, layers: [{ id: "plain", type: "background", paint: { "background-color": "#dae6e6" } }],
      } });
      return url.origin === base ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const toggle = page.getByRole("button", { name: "Measure distance" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const add = async (x: number, y: number) => {
      if (touch) await page.locator("#map").tap({ position: { x, y } });
      else await page.locator("#map").click({ position: { x, y } });
    };
    const first = touch ? [280, 390] : [410, 380];
    const second = touch ? [310, 470] : [610, 390];
    await add(first[0]!, first[1]!);
    await expect(page.locator(".distance-result")).toHaveText("Start point set");
    await add(second[0]!, second[1]!);
    await expect(page.locator(".distance-result")).toContainText("km");
    const distance = await page.locator(".distance-result").innerText();
    const route = await page.locator(".distance-line").getAttribute("d");
    assert.ok(route?.includes("L"));
    await expect(page.locator("#selected-flag")).toHaveAttribute("hidden", "");
    await page.screenshot({ path: join(output, `distance-${viewport.width}.png`) });
    await page.evaluate(() => {
      const card = document.createElement("section");
      card.className = "forecast-alert-card";
      document.querySelector("#app")!.append(card);
    });
    await expect(toggle).toBeHidden();
    await page.locator(".forecast-alert-card").evaluate((card) => card.remove());
    await page.evaluate(() => {
      const chip = document.createElement("button");
      chip.className = "forecast-alert-chip";
      chip.textContent = "3 forecast matches";
      document.querySelector("#app")!.append(chip);
    });
    const buttonBox = await toggle.boundingBox(), chipBox = await page.locator(".forecast-alert-chip").boundingBox();
    assert.ok(buttonBox && chipBox && (buttonBox.y + buttonBox.height <= chipBox.y || chipBox.y + chipBox.height <= buttonBox.y),
      "Distance button must not overlap the collapsed forecast alert");
    await page.locator(".forecast-alert-chip").evaluate((chip) => chip.remove());
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => page.locator(".distance-line").getAttribute("d")).not.toBe(route);
    await expect(page.locator(".distance-result")).toHaveText(distance);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".distance-result")).toHaveText("Start point set");
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.locator(".distance-line")).toHaveAttribute("d", "");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".distance-panel")).toBeHidden();
    await expect(toggle).toHaveText("Measure");
    await add(first[0]!, first[1]!);
    await expect(page.locator("#selected-flag")).not.toHaveAttribute("hidden", "");
    assert.deepEqual(errors, []);
    console.log(`Distance tool passed at ${viewport.width}px (${touch ? "touch" : "mouse"}).`);
    await context.close();
  }
  console.log(`Distance screenshots: ${output}`);
} finally { await browser.close(); await new Promise<void>((done) => server.close(() => done())); }

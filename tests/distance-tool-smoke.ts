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
  for (const viewport of [{ width: 1000, height: 760 }, { width: 856, height: 608 }, { width: 390, height: 844 }]) {
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
    if (!touch) {
      await page.locator("#map").hover({ position: { x: second[0]!, y: second[1]! } });
      await expect(page.locator(".distance-line-preview")).not.toHaveAttribute("d", "");
      await expect(page.locator(".distance-result")).toContainText("km");
    }
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
    await page.evaluate(() => {
      const ui = document.querySelector("#ui")!;
      const base = document.createElement("section");
      base.className = "basemap-tools";
      base.innerHTML = '<div class="layer-switch basemap-switch"><button>Map</button><button>Satellite</button></div><button class="imagery-history-toggle">Imagery history</button><label class="basemap-overlay"><input type="checkbox">Weather overlay</label>';
      const chip = document.createElement("button");
      chip.className = "forecast-alert-chip";
      chip.textContent = "7 forecast matches ↗";
      const history = document.createElement("section");
      history.className = "imagery-history-panel";
      history.innerHTML = '<div class="imagery-history-head"><strong>Imagery history</strong><span>Esri Wayback</span></div><p>Dates at selected pin · zoom 14</p><p>Finding local captures…</p>';
      ui.append(base, chip, history);
    });
    await expect(toggle).toBeHidden();
    const [baseBox, stackedChipBox, historyBox] = await Promise.all([
      page.locator(".basemap-tools").boundingBox(), page.locator(".forecast-alert-chip").boundingBox(), page.locator(".imagery-history-panel").boundingBox(),
    ]);
    assert.ok(baseBox && stackedChipBox && historyBox &&
      baseBox.y + baseBox.height <= stackedChipBox.y && stackedChipBox.y + stackedChipBox.height <= historyBox.y,
      "Map background, forecast matches, and imagery history must stack without overlap");
    const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const selector of [".masthead", ".error-card", ".timeline"]) {
      const other = await page.locator(selector).boundingBox();
      if (other) assert.ok(!intersects(historyBox, other), `Imagery history must clear ${selector}`);
    }
    await page.screenshot({ path: join(output, `controls-${viewport.width}.png`) });
    await page.locator(".basemap-tools, .forecast-alert-chip, .imagery-history-panel").evaluateAll((elements) => elements.forEach((element) => element.remove()));
    await expect(toggle).toBeVisible();
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

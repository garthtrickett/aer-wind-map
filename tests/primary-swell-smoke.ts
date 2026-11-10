import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";

const root = resolve("dist");
const output = process.env.SMOKE_OUTPUT ?? "/tmp/aer-primary-swell-smoke";
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try { response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" } as Record<string, string>)[extname(file)] ?? "application/octet-stream"); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const results: unknown[] = [];
try {
  for (const fallback of process.env.SMOKE_LIVE ? [false] : [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await context.addInitScript((fallback) => {
      if (fallback) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          return kind.includes("webgl") ? null : Reflect.apply(original, this, [kind, ...args]);
        } as typeof original;
      }
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener("message", (event) => {
            if (event.data?.ok && event.data.field?.kind === "waves") (window as any).swellField = event.data.field;
          });
        }
      };
    }, fallback);
    const page = await context.newPage(); const errors: string[] = [], combinedRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (/\/wave\/.*\.(?:index|grib2)/.test(request.url())) combinedRequests.push(request.url()); });
    await context.route("https://tiles.openfreemap.org/**", (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "plain", type: "background", paint: { "background-color": "#dae6e6" } }] } }));
    await context.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await context.route("https://storage.googleapis.com/**", (route) => route.abort());
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Swell", exact: true }).click();
    await page.waitForFunction(() => (window as any).swellField?.source === "mfwam-primary", undefined, { timeout: 90_000 });
    await expect(page.getByText("Live forecast", { exact: true })).toBeVisible();
    const input = page.getByLabel("Find a place or coordinates", { exact: true });
    await input.fill("23.375, 122.375"); await input.press("Enter");
    await expect(page.locator(".flag-caption")).toContainText("Primary swell");
    await expect(page.locator(".flag-source")).toHaveText("MFWAM");
    await expect(page.locator(".flag-swell")).toHaveCount(0);
    const expected = await page.evaluate(() => {
      const field = (window as any).swellField;
      const x = Math.round((122.375 - field.firstLongitude) / field.increment);
      const y = Math.round((field.firstLatitude - 23.375) / field.increment);
      const index = y * field.width + x;
      return { height: field.waveHeight[index], period: field.wavePeriod[index], direction: field.waveDirection[index], step: field.step, run: field.run };
    });
    await expect(page.locator(".flag-speed strong")).toHaveText(expected.height.toFixed(1));
    await expect(page.locator(".flag-wave-meta")).toContainText(`${expected.period.toFixed(1)} s`);
    await expect(page.locator(".flag-wave-direction")).toContainText(`${Math.round(expected.direction)}°`);
    assert.doesNotMatch(await page.locator("#ui").innerText(), /Combined waves|WAVES \+ SWELL/);
    await page.getByRole("button", { name: "Open forecast details", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Primary swell at this location", exact: true })).toContainText("MFWAM");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    for (const width of [1000, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(async () => {
        const box = await page.locator(".flag-panel").boundingBox();
        return Boolean(box && box.x >= 0 && box.x + box.width <= width + 1);
      }).toBe(true);
      await page.screenshot({ path: `${output}/${fallback ? "canvas" : "webgl"}-${width}.png` });
    }
    assert.deepEqual(errors, []); assert.deepEqual(combinedRequests, []);
    results.push({ fallback, expected, errors, combinedRequests });
    await context.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ base, results }, null, 2));
  console.log(JSON.stringify({ base, results, output }));
} finally { await browser.close(); await new Promise<void>((done) => server.close(() => done())); }

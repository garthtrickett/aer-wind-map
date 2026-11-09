import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const address = server.httpServer!.address(); assert.ok(address && typeof address !== "string");
const browser = await chromium.launch({ headless: true });
const output = await mkdtemp(join(tmpdir(), "aer-wave-motion-"));
try {
 for (const fallback of [false, true]) for (const reduced of [false, true]) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 760 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  if (fallback) await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind: string, ...args: unknown[]) {
      return kind.includes("webgl") ? null : Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await context.route("https://tiles.openfreemap.org/styles/positron", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "plain", type: "background", paint: { "background-color": "#dae6e6" } }] } }));
  await context.route("https://tile.openstreetmap.org/**", route => route.abort());
  const page = await context.newPage(); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/tests/fixtures/map-visual.html`);
  await page.waitForFunction(() => (window as any).mapVisual?.ready);
  await expect(page.locator(".flag-wave-direction")).toContainText("from S · 180°");
  await expect(page.locator(".flag-swell-direction")).toContainText("from SW · 225°");
  await expect(page.locator(".flag-swell")).toContainText("1.4 m · 13.0 s");
  // Frame captures prove live motion and reduced-motion stability without reading discarded WebGL back buffers.
  await page.waitForTimeout(500);
  const canvas = page.locator("#wind-arrows");
  const first = await canvas.screenshot(); await page.waitForTimeout(400); const next = await canvas.screenshot();
  assert.equal(first.equals(next), reduced, `animation state: fallback=${fallback}, reduced=${reduced}`);
  await page.screenshot({ path: join(output, `waves-${fallback ? "canvas" : "webgl"}-${reduced ? "static" : "moving"}.png`) });
  const markers = await page.evaluate(() => (window as any).mapVisual.alignments());
  await writeFile(join(output, `markers-${fallback}-${reduced}.json`), JSON.stringify(markers, null, 2));
  if (!process.env.RECORD_MARKER_BASELINE) for (const marker of markers) {
    assert.equal(marker.position, "absolute");
    assert.ok(Math.abs(marker.dx) < 1.1 && Math.abs(marker.dy) < 1.1, JSON.stringify(marker));
  }
  await page.evaluate(() => (window as any).mapVisual.setLayer(null));
  await page.waitForTimeout(120); const empty = await canvas.screenshot();
  assert.ok(!empty.equals(next), "turning overlay off clears particles");
  await page.evaluate(() => (window as any).mapVisual.setLayer("wind"));
  await page.waitForTimeout(200);
  assert.ok(!(await canvas.screenshot()).equals(empty), "wind arrows return after layer switch");
  await page.evaluate(() => (window as any).mapVisual.setView(27, 128, 8.4));
  await page.waitForTimeout(250);
  if (!process.env.RECORD_MARKER_BASELINE) for (const marker of await page.evaluate(() => (window as any).mapVisual.alignments()))
    assert.ok(Math.abs(marker.dx) < 1.1 && Math.abs(marker.dy) < 1.1, JSON.stringify(marker));
  await page.evaluate(() => (window as any).mapVisual.setFlag(null));
  await expect(page.locator(".flag-swell-direction")).toHaveText("Direction unavailable");
  if (!fallback && !reduced) for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    for (const y of [100, 200, 500]) {
      await page.evaluate(({ x, y }) => (window as any).mapVisual.flagAt(x, y), { x: width - 20, y });
      const box = await page.locator(".flag-panel").boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 844, JSON.stringify(box));
    }
    await page.screenshot({ path: join(output, `waves-mobile-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  await context.close();
 }
 console.log(JSON.stringify({ passed: true, output, markerBaseline: !!process.env.RECORD_MARKER_BASELINE }));
} finally { await browser.close(); await server.close(); }

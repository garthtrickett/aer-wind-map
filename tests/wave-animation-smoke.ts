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
  if (process.env.PAN_ONLY && (fallback || !reduced)) continue;
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
  await expect(page.locator(".flag-caption")).toContainText("Primary swell");
  await expect(page.locator(".flag-source")).toHaveText("MFWAM");
  await expect(page.locator(".flag-swell")).toHaveCount(0);
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
  if (reduced && !fallback) {
    await page.addStyleTag({ content: "#map { background: #000 !important; } .maplibregl-canvas, .saved-spot-icon, #selected-flag, .leaflet-control-container { visibility: hidden !important; }" });
    const beforePan = (await canvas.screenshot()).toString("base64");
    await page.evaluate(() => (window as any).mapVisual.panBy(-120, -40));
    await page.waitForTimeout(250);
    const afterPan = (await canvas.screenshot()).toString("base64");
    await writeFile(join(output, "pan-before.png"), Buffer.from(beforePan, "base64"));
    await writeFile(join(output, "pan-after.png"), Buffer.from(afterPan, "base64"));
    const shifted = await page.evaluate(async ({ before, after }) => {
      const pixels = async (png: string) => {
        const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
        const image = await createImageBitmap(blob), surface = document.createElement("canvas");
        surface.width = image.width; surface.height = image.height;
        const context = surface.getContext("2d")!; context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, surface.width, surface.height);
      };
      const a = await pixels(before), b = await pixels(after);
      const white = (data: Uint8ClampedArray, x: number, y: number) => {
        const i = (y * a.width + x) * 4; return data[i]! > 110 && data[i + 1]! > 110 && data[i + 2]! > 110;
      };
      const score = (dx: number, dy: number) => {
        let count = 0, moved = 0;
        // The padded MapLibre canvas extends beyond the 1000 × 760 viewport.
        for (let y = 80; y < 680; y++) for (let x = 80; x < 840; x++) if (white(a.data, x, y)) {
          count++; if (white(b.data, x + dx, y + dy)) moved++;
        }
        return count ? moved / count : 0;
      };
      const candidates = [];
      for (let dy = 38; dy <= 42; dy++) for (let dx = 118; dx <= 122; dx++) candidates.push({ dx, dy, score: score(dx, dy) });
      return { fixed: score(0, 0), exact: score(120, 40), best: candidates.sort((a, b) => b.score - a.score)[0] };
    }, { before: beforePan, after: afterPan });
    console.log(JSON.stringify({ output, shifted }));
    assert.ok(shifted.exact > .5 && shifted.exact > shifted.fixed * 1.5, `static particles must follow the map: ${JSON.stringify(shifted)}`);
    await page.addStyleTag({ content: ".maplibregl-canvas, .saved-spot-icon, #selected-flag, .leaflet-control-container { visibility: visible !important; }" });
  }
  await page.evaluate(() => (window as any).mapVisual.setFlag(null));
  await expect(page.locator(".flag-wave-direction")).toHaveText("Direction unavailable");
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

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, firefox, webkit, type Browser } from "@playwright/test";

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
const server = port === null ? null : spawn(process.execPath, ["scripts/serve.ts"], { stdio: "pipe", env: { ...process.env, PORT: String(port) } });
const base = remoteBase ?? `http://127.0.0.1:${port}`;
let browser: Browser | null = null;

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(base)).ok; } catch { /* server starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Preview server did not start");

  const engine = process.env.BROWSER === "firefox" ? firefox : process.env.BROWSER === "webkit" ? webkit : chromium;
  browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.method() === "GET") errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.request().method() === "GET" && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const wasm = await page.request.head(`${base}/decoder/eccodes.wasm`, { headers: { "Accept-Encoding": "gzip" } });
  if (wasm.headers()["content-encoding"] !== "gzip") throw new Error("WASM is not served compressed");
  try {
    await page.getByText("Live forecast").waitFor({ timeout: 45_000 });
  } catch (error) {
    await page.screenshot({ path: "/tmp/wind-map-failed.png", fullPage: true });
    console.error(JSON.stringify({ ui: await page.locator("#ui").innerText(), errors }, null, 2));
    throw error;
  }
  await page.screenshot({ path: "/tmp/wind-map-live.png", fullPage: true });
  const attribution = await page.locator(".leaflet-control-attribution").innerText();
  const webgl2 = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
  if (!attribution.includes("OpenStreetMap") || !attribution.includes("ECMWF") || (webgl2 && (attribution.match(/OpenFreeMap/g) || []).length !== 1)) {
    throw new Error(`Incorrect map attribution: ${attribution}`);
  }

  await page.locator("#map").click({ position: { x: 700, y: 400 } });
  await page.locator(".flag-grab").waitFor({ state: "visible" });
  if (await page.getByRole("dialog").count()) throw new Error("Map click blocked flag dragging with a modal");
  const pointBefore = await page.locator(".flag-point").boundingBox();
  if (!pointBefore || Math.abs(pointBefore.x + pointBefore.width / 2 - 700) > 3 || Math.abs(pointBefore.y + pointBefore.height / 2 - 400) > 3) {
    throw new Error(`Wind flag is not anchored at the selected point: ${JSON.stringify(pointBefore)}`);
  }
  await page.screenshot({ path: "/tmp/wind-map-flag.png", fullPage: true });
  const grab = await page.locator(".flag-grab").boundingBox();
  if (!grab) throw new Error("Wind flag has no drag handle");
  const startX = grab.x + grab.width / 2;
  const startY = grab.y + grab.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 65, { steps: 8 });
  await page.mouse.up();
  const pointAfter = await page.locator(".flag-point").boundingBox();
  if (!pointAfter || Math.abs(pointAfter.x + pointAfter.width / 2 - 780) > 4 || Math.abs(pointAfter.y + pointAfter.height / 2 - 465) > 4) {
    throw new Error(`Wind flag did not follow the drag: ${JSON.stringify(pointAfter)}`);
  }
  if (await page.getByRole("dialog").count()) throw new Error("Dragging the wind flag opened details");
  await page.locator(".flag-grab").click();
  await page.getByRole("dialog", { name: "Wind at this location" }).waitFor();
  const modal = await page.getByRole("dialog").innerText();
  await page.screenshot({ path: "/tmp/wind-map-modal.png", fullPage: true });
  if (!modal.includes("Maximum gust") || !modal.includes("Direction from") || !modal.includes("m/s")) throw new Error(`Incomplete modal: ${modal}`);
  const colorAlpha = await page.locator("#wind-color").evaluate((canvas: HTMLCanvasElement) => canvas.getContext("2d")?.getImageData(780, 465, 1, 1).data[3] ?? 0);
  if (!colorAlpha) throw new Error("Wind color disappeared after selecting a point");

  await page.getByRole("button", { name: "Close details" }).focus();
  await page.keyboard.press("Escape");
  if (await page.getByRole("dialog").count()) throw new Error("Escape did not close details");
  await page.screenshot({ path: "/tmp/wind-map-selected.png", fullPage: true });
  await page.getByRole("button", { name: "Next forecast time" }).click();
  try {
    await page.getByText("Live forecast").waitFor({ timeout: 45_000 });
  } catch (error) {
    await page.screenshot({ path: "/tmp/wind-map-next-step-failed.png", fullPage: true });
    console.error(JSON.stringify({ ui: await page.locator("#ui").innerText(), errors }, null, 2));
    throw error;
  }
  if (!await page.locator(".flag-grab").isVisible()) throw new Error("Wind flag disappeared after changing forecast time");
  await page.getByRole("button", { name: "Remove wind flag" }).click();
  if (await page.locator(".flag-grab").count()) throw new Error("Wind flag did not close");
  const title = await page.title();
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: engine !== firefox, hasTouch: true });
  mobile.on("pageerror", (error) => errors.push(error.message));
  const mobileStart = Date.now();
  await mobile.goto(base, { waitUntil: "domcontentloaded" });
  try {
    await mobile.getByText("Live forecast").waitFor({ timeout: 45_000 });
  } catch (error) {
    await mobile.screenshot({ path: "/tmp/wind-map-mobile-failed.png", fullPage: true });
    console.error(JSON.stringify({ ui: await mobile.locator("#ui").innerText(), errors }, null, 2));
    throw error;
  }
  const mobileLoadMs = Date.now() - mobileStart;
  await mobile.screenshot({ path: "/tmp/wind-map-mobile.png", fullPage: true });
  await mobile.getByRole("button", { name: "Inspect map center" }).click();
  await mobile.locator(".flag-grab").waitFor({ state: "visible" });
  await mobile.screenshot({ path: "/tmp/wind-map-mobile-flag.png", fullPage: true });
  if (engine === chromium) {
    const beforeTouch = await mobile.locator(".flag-point").boundingBox();
    const handle = await mobile.locator(".flag-grab").boundingBox();
    if (!beforeTouch || !handle) throw new Error("Mobile wind flag is missing");
    const startX = handle.x + handle.width / 2;
    const startY = handle.y + handle.height / 2;
    const cdp = await mobile.context().newCDPSession(mobile);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y: startY, id: 1 }] });
    for (let step = 1; step <= 5; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX + step * 9, y: startY + step * 7, id: 1 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const afterTouch = await mobile.locator(".flag-point").boundingBox();
    if (!afterTouch || Math.abs(afterTouch.x - beforeTouch.x - 45) > 5 || Math.abs(afterTouch.y - beforeTouch.y - 35) > 5) {
      throw new Error(`Touch drag did not move the flag: ${JSON.stringify({ beforeTouch, afterTouch })}`);
    }
  }
  await mobile.getByRole("button", { name: "Open wind details" }).click();
  await mobile.getByRole("dialog", { name: "Wind at this location" }).waitFor();
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error("Mobile layout overflows horizontally");
  await mobile.close();

  if (engine === chromium) {
    const reduced = await browser.newPage({ reducedMotion: "reduce" });
    await reduced.goto(base, { waitUntil: "domcontentloaded" });
    await reduced.getByText("Live forecast").waitFor({ timeout: 45_000 });
    await reduced.waitForTimeout(500);
    const before = await reduced.locator("#wind-arrows").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await reduced.waitForTimeout(250);
    const after = await reduced.locator("#wind-arrows").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    if (before !== after) throw new Error("Reduced-motion arrows still change between frames");
    await reduced.close();

    const recovery = await browser.newPage();
    await recovery.route("**/decoder/worker.js", (route) => route.fulfill({ status: 404, body: "Decoder temporarily unavailable" }));
    await recovery.goto(base, { waitUntil: "domcontentloaded" });
    await recovery.getByText("Forecast unavailable").waitFor({ timeout: 45_000 });
    await recovery.unroute("**/decoder/worker.js");
    await recovery.getByRole("button", { name: "Try again" }).click();
    await recovery.getByText("Live forecast").waitFor({ timeout: 45_000 });
    await recovery.close();
  }
  console.log(JSON.stringify({ ok: true, browser: engine === chromium ? "chromium" : engine === firefox ? "firefox" : "webkit", mobileLoadMs, title, modal, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}

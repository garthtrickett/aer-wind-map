import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { defaultHistoryCriteria } from "../../src/history.ts";
import { forecastAlertKey, loadForecastAlerts, type ForecastAlertSummary } from "../../src/forecast-alerts.ts";
import type { SavedSpot } from "../../src/saved-spots.ts";
import { openAlertStore, digest, type AlertStore } from "./store.ts";
import { createMonitor, notificationFor } from "./monitor.ts";
import { createAlertHttp } from "./http.ts";
import { createTelegram, type Telegram, type TelegramSend } from "./telegram.ts";

const now = Date.parse("2026-10-23T00:00:00Z");
const spot: SavedSpot = { id: "bukit", name: "Wet season Bukit", point: { latitude: -8.78, longitude: 115.07 },
  startYear: 2023, endYear: 2025, criteria: { ...defaultHistoryCriteria, maxSwellPeriod: 15 }, alertEnabled: true, alertMinDays: 2 };
const summary = (days = ["2026-10-28", "2026-10-29"]): ForecastAlertSummary => ({
  windows: days.map((day) => ({ day, start: Date.parse(`${day}T06:00:00Z`) / 1000, end: Date.parse(`${day}T09:00:00Z`) / 1000 })),
  matchingDays: days.length, availableDays: 12, horizonDays: 14, requiredHours: 2,
  nextWindowStart: Date.parse(`${days[0]}T06:00:00Z`) / 1000, timezone: "UTC", checkedAt: now,
});
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "aer-telegram-"));
  const path = join(dir, "alerts.sqlite");
  const store = openAlertStore(path);
  return { path, store, clean: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
};
const connect = (store: AlertStore, at = now, update = 1, chatId = 12345) => {
  const link = store.beginLink(null, at);
  const owner = digest(link.cookie!);
  store.applyUpdate({ update_id: update, message: { message_id: update, text: `/start ${link.token}`,
    chat: { id: chatId, type: "private" }, from: { id: chatId } } }, at);
  assert.equal(store.status(owner, at).connected, true);
  return { owner, cookie: link.cookie!, token: link.token };
};
const transport = (result: TelegramSend = { kind: "sent", messageId: 10 }) => {
  const messages: string[] = [];
  const telegram: Telegram = { identity: async () => "aer_bot", updates: async () => [],
    send: async (_chat, text) => { messages.push(text); return result; } };
  return { telegram, messages };
};

test("one-use links require a private human; cursor, owner and snapshots survive restart", () => {
  const f = fixture();
  try {
    const link = f.store.beginLink(null, now);
    const owner = digest(link.cookie!);
    const start = { update_id: 1, message: { message_id: 1, text: `/start ${link.token}`, chat: { id: -42, type: "group" }, from: { id: 42 } } };
    f.store.applyUpdate(start, now);
    assert.equal(f.store.status(owner, now).connected, false);
    const human = { update_id: 2, message: { ...start.message, chat: { id: 42, type: "private" } } };
    f.store.applyUpdate(human, now);
    assert.equal(f.store.status(owner, now).connected, true);
    assert.equal(f.store.sync(owner, [spot], 0), true);
    f.store.applyUpdate({ ...human, update_id: 3, message: { ...human.message, chat: { id: 99, type: "private" }, from: { id: 99 } } }, now);
    assert.equal(f.store.due(now)[0].chatId, 42);
    assert.equal(f.store.offset(), 4);
    f.store.close();
    const reopened = openAlertStore(f.path);
    assert.equal(reopened.status(owner, now).spotCount, 1);
    assert.equal(reopened.offset(), 4);
    assert.equal(reopened.sync(owner, [], 0), false, "stale tab must not erase newer settings");
    assert.deepEqual(reopened.spot(owner, spot.id), spot);
    reopened.close();
    // fixture's original handle is closed, clean the directory directly.
  } finally { rmSync(f.path.substring(0, f.path.lastIndexOf("/")), { recursive: true, force: true }); }
});

test("expired tokens do not link and tokens/cookies are not stored in plaintext", () => {
  const f = fixture();
  try {
    const link = f.store.beginLink(null, now);
    f.store.applyUpdate({ update_id: 1, message: { message_id: 1, text: `/start ${link.token}`, chat: { id: 42, type: "private" }, from: { id: 42 } } }, now + 600_001);
    assert.equal(f.store.status(digest(link.cookie!), now + 600_001).connected, false);
  } finally { f.clean(); }
});

test("the first test message is allowed immediately after linking, with a cooldown on subsequent tests", () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store);
    assert.equal(f.store.test(owner, now), true);
    assert.equal(f.store.test(owner, now + 1000), false);
    assert.equal(f.store.test(owner, now + 60_001), true);
  } finally { f.clean(); }
});

test("linked dependencies persist without their own alert, appear in phone links, and edits reject an in-flight result", async () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store);
    const peer: SavedSpot = { ...spot, id: "coast", name: "Nearshore wind", alertEnabled: false,
      criteria: { ...spot.criteria, conditions: "wind" } };
    const root: SavedSpot = { ...spot, linkedSpotIds: [peer.id], criteria: { ...spot.criteria, conditions: "swell" } };
    assert.equal(f.store.sync(owner, [root, peer], 0), true);
    assert.equal(f.store.status(owner, now).spotCount, 1);
    assert.equal(f.store.due(now).length, 1);
    for (const reply of f.store.pending(now)) {
      f.store.beginDelivery(reply, now);
      f.store.delivered(reply, { kind: "sent", messageId: 1 }, now);
    }
    const watch = f.store.due(now)[0];
    assert.deepEqual(watch.catalog, [root, peer]);
    const joint = { ...summary(), linkedRequirements: [{ id: peer.id, name: peer.name, rules: [{ minDays: 2, withinDays: 14 }] }] };
    const notification = notificationFor(watch, joint, now, "https://aer.example");
    assert.ok(notification);
    assert.match(notification.text, /Linked: Nearshore wind/);
    assert.match(notification.text, /Any wind direction passes at or below 2 km\/h/);
    f.store.checked(watch, joint, now, notification);
    const queued = f.store.pending(now).find((delivery) => delivery.spot_id === root.id)!;
    assert.ok(queued);
    const token = new URL(queued.url!).hash.slice("#forecast=".length);
    assert.equal(f.store.view(token, now)?.id, root.id);
    assert.deepEqual(f.store.viewLinked(token, now), [peer]);
    const changed = { ...peer, criteria: { ...peer.criteria, maxWindSpeed: 1 } };
    assert.equal(f.store.sync(owner, [root, changed], 1), true);
    f.store.checked(watch, joint, now + 1, notification);
    assert.equal(f.store.due(now + 1).length, 1, "old result cannot mark the edited dependency checked");
    assert.equal(f.store.pending(now + 1).filter((delivery) => delivery.spot_id).length, 0);
    const current = f.store.due(now + 1)[0];
    assert.equal(current.qualified, false);
    assert.equal(current.catalog?.find((item) => item.id === peer.id)?.criteria.maxWindSpeed, 1);
    f.store.checked(current, joint, now + 1, notification);
    const inFlight = f.store.pending(now + 1).find((delivery) => delivery.spot_id === root.id)!;
    assert.ok(f.store.beginDelivery(inFlight, now + 1));
    f.store.sync(owner, [root, peer], 2);
    f.store.delivered(inFlight, { kind: "sent", messageId: 2 }, now + 2);
    assert.equal(f.store.due(now + 2)[0].qualified, false, "an acknowledgement for old peer conditions cannot qualify the new group");
    f.store.close();
    const reopened = openAlertStore(f.path);
    assert.equal(reopened.due(now + 1)[0].catalog?.length, 2);
    reopened.close();
  } finally { rmSync(f.path.substring(0, f.path.lastIndexOf("/")), { recursive: true, force: true }); }
});

test("closed-tab monitor uses both real scoring paths and sends only when every linked day rule passes", async () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store);
    const peer: SavedSpot = { ...spot, id: "coast", name: "Nearshore wind", alertEnabled: false,
      criteria: { ...spot.criteria, conditions: "wind", windFromStart: 315, windFromEnd: 45 },
      alertRules: [{ minDays: 3, withinDays: 4 }] };
    const root: SavedSpot = { ...spot, name: "Offshore swell", linkedSpotIds: [peer.id],
      criteria: { ...spot.criteria, conditions: "swell" }, alertRules: [{ minDays: 2, withinDays: 4 }] };
    const time = Array.from({ length: 10 * 24 }, (_, i) => now / 1000 + i * 3600);
    const fetcher: typeof fetch = async (input) => Response.json({ timezone: "UTC", hourly: { time,
      ...(String(input).includes("marine-api")
        ? { swell_wave_height: time.map(() => 2), swell_wave_period: time.map(() => 12), swell_wave_direction: time.map(() => 220) }
        : { wind_speed_10m: time.map(() => 3), wind_direction_10m: time.map((_, i) => [3, 4].includes(Math.floor(i / 24)) ? 355 : 180) }) } });
    const transportFake = transport();
    const monitor = createMonitor({ store: f.store, telegram: transportFake.telegram, publicUrl: "https://aer.example",
      clock: () => now, report: () => {}, load: (roots, at, catalog) => loadForecastAlerts(roots, at, fetcher, catalog) });
    f.store.sync(owner, [root, peer], 0);
    await monitor.tick();
    assert.equal(transportFake.messages.filter((text) => text.includes("All linked conditions match")).length, 0);
    f.store.sync(owner, [root, { ...peer, alertRules: [{ minDays: 2, withinDays: 4 }] }], 1);
    await monitor.tick();
    assert.equal(transportFake.messages.filter((text) => text.includes("All linked conditions match")).length, 1);
    await monitor.tick();
    assert.equal(transportFake.messages.filter((text) => text.includes("All linked conditions match")).length, 1);
  } finally { f.clean(); }
});

test("background linked lookup keeps identical spot IDs isolated between owners", async () => {
  const f = fixture();
  try {
    const first = connect(f.store, now, 1, 111);
    const second = connect(f.store, now, 2, 222);
    const peer = { ...spot, id: "shared-id", alertEnabled: false };
    const root = { ...spot, linkedSpotIds: [peer.id] };
    f.store.sync(first.owner, [root, { ...peer, name: "First coast" }], 0);
    f.store.sync(second.owner, [root, { ...peer, name: "Second coast" }], 0);
    const seen: string[] = [];
    const monitor = createMonitor({ store: f.store, telegram: transport().telegram,
      publicUrl: "https://aer.example", clock: () => now, report: () => {},
      load: async (roots, _at, catalog) => {
        assert.equal(roots.length, 1);
        seen.push(catalog!.find((item) => item.id === peer.id)!.name);
        return [];
      } });
    await monitor.tick();
    assert.deepEqual(seen.sort(), ["First coast", "Second coast"]);
  } finally { f.clean(); }
});

test("background checking sends once, survives restart, ignores unavailable forecasts and confirms closer dates", async () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store);
    f.store.sync(owner, [spot], 0);
    let at = now;
    let unavailable = false;
    const { telegram, messages } = transport();
    const monitor = createMonitor({ store: f.store, telegram, publicUrl: "https://aer.example/", clock: () => at, report: () => {},
      load: async (spots) => spots.map((s) => unavailable ? { id: s.id, key: forecastAlertKey(s), ok: false, error: { kind: "unavailable" } }
        : { id: s.id, key: forecastAlertKey(s), ok: true, summary: summary() }) });
    await monitor.tick(); // connection confirmation before forecast, one send/chat/cycle
    at += 1000; await monitor.tick();
    assert.equal(messages.filter((text) => text.includes("forecast heads-up")).length, 1);
    assert.match(messages.at(-1)!, /12\/14/);
    assert.match(messages.at(-1)!, /Météo-France MFWAM primary swell \+ ECMWF IFS wind/);
    assert.match(messages.at(-1)!, /up to 10 days; later days are unknown/);
    at += 21_600_000; await monitor.tick();
    assert.equal(messages.length, 2);
    unavailable = true; at += 21_600_000; await monitor.tick();
    assert.equal(f.store.status(owner, at).issue, "forecast");
    unavailable = false; at += 900_001; await monitor.tick();
    assert.equal(messages.length, 2);
    at = Date.parse("2026-10-26T07:00:00Z"); await monitor.tick();
    assert.match(messages.at(-1)!, /Closer-range forecast confirmation/);
    at += 21_600_000; await monitor.tick();
    assert.equal(messages.length, 3, "the same near dates must not be confirmed every six hours");
  } finally { f.clean(); }
});

test("stop and edits during an outstanding forecast prevent stale delivery", async () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store); f.store.sync(owner, [spot], 0);
    const watch = f.store.due(now)[0];
    const s = summary(); const notification = notificationFor(watch, s, now, "https://aer.example/")!;
    f.store.sync(owner, [{ ...spot, criteria: { ...spot.criteria, maxSwellPeriod: 10 } }], 1);
    f.store.checked(watch, s, now, notification);
    assert.equal(f.store.pending(now).filter((row) => row.spot_id).length, 0);
    const current = f.store.due(now)[0];
    f.store.checked(current, s, now, notification);
    const delivery = f.store.pending(now + 1000).find((row) => row.spot_id);
    // Connection reply comes first; clear it to inspect the forecast queue.
    const first = f.store.pending(now)[0];
    if (!first.spot_id) { f.store.beginDelivery(first, now); f.store.delivered(first, { kind: "sent", messageId: 1 }, now); }
    const queued = delivery ?? f.store.pending(now)[0];
    f.store.applyUpdate({ update_id: 2, message: { message_id: 2, text: "/stop", chat: { id: 12345, type: "private" }, from: { id: 12345 } } }, now + 2000);
    assert.equal(f.store.status(owner, now).connected, false);
    assert.equal(f.store.due(now).length, 0);
    assert.equal(f.store.beginDelivery(queued, now + 3000), false);
  } finally { f.clean(); }
});

test("ambiguous sends are held across worker recovery; explicit rejections back off; blocked chats disconnect", () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store);
    assert.equal(f.store.lease("worker-a", now), true);
    const delivery = f.store.pending(now)[0];
    f.store.beginDelivery(delivery, now);
    assert.equal(f.store.lease("worker-b", now + 1000), false);
    assert.equal(f.store.lease("worker-b", now + 300_001), true);
    assert.equal(f.store.pending(now + 300_001).length, 0);
    assert.equal(f.store.status(owner, now).issue, "uncertain");
    assert.equal(f.store.test(owner, now + 400_000), true);
    const testMessage = f.store.pending(now + 400_000)[0];
    f.store.beginDelivery(testMessage, now + 400_000);
    f.store.delivered(testMessage, { kind: "retry", afterMs: 60_000 }, now + 400_000);
    assert.equal(f.store.pending(now + 459_999).length, 0);
    const retry = f.store.pending(now + 460_001)[0];
    assert.ok(retry);
    f.store.beginDelivery(retry, now + 460_001);
    f.store.delivered(retry, { kind: "blocked" }, now + 460_001);
    assert.equal(f.store.status(owner, now).connected, false);
    assert.equal(f.store.status(owner, now).issue, "blocked");
  } finally { f.clean(); }
});

test("Telegram transport never blindly retries an ambiguous acceptance", async () => {
  for (const [body, expected] of [[{ ok: true, result: { message_id: 7 } }, "sent"],
    [{ ok: false, error_code: 429, parameters: { retry_after: 90 } }, "retry"],
    [{ ok: false, error_code: 403 }, "blocked"], [{ invalid: true }, "uncertain"]] as const) {
    const telegram = createTelegram({ token: "fake-token", fetcher: async () => new Response(JSON.stringify(body)) });
    assert.equal((await telegram.send(1, "test")).kind, expected);
  }
  const telegram = createTelegram({ token: "fake-token", fetcher: async () => { throw new Error("timeout"); } });
  assert.equal((await telegram.send(1, "test")).kind, "uncertain");
});

test("a fresh process retains sent-day deduplication; rolling days do not trigger the same alert", () => {
  const dir = mkdtempSync(join(tmpdir(), "aer-telegram-restart-"));
  const path = join(dir, "alerts.sqlite");
  let store = openAlertStore(path);
  try {
    const { owner } = connect(store); store.sync(owner, [spot], 0);
    const command = store.pending(now)[0]; store.beginDelivery(command, now); store.delivered(command, { kind: "sent", messageId: 1 }, now);
    let watch = store.due(now)[0];
    const scored = summary();
    store.checked(watch, scored, now, notificationFor(watch, scored, now, "https://aer.example/")!);
    const alert = store.pending(now)[0]; store.beginDelivery(alert, now); store.delivered(alert, { kind: "sent", messageId: 2 }, now);
    store.close(); store = openAlertStore(path);
    watch = store.due(now + 21_600_001)[0];
    assert.equal(notificationFor(watch, { ...scored, availableDays: 13 }, now + 21_600_001, "https://aer.example/"), null);
    store.checked(watch, { ...scored, matchingDays: 0, windows: [] }, now + 21_600_001);
    watch = store.due(now + 43_200_002)[0];
    assert.ok(notificationFor(watch, scored, now + 43_200_002, "https://aer.example/"), "a genuine lost/recovered match re-arms");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("notification links work read-only without the owner session, expire and are revoked on disconnect", () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store);
    f.store.sync(owner, [spot], 0);
    const reply = f.store.pending(now)[0]; f.store.beginDelivery(reply, now); f.store.delivered(reply, { kind: "sent", messageId: 1 }, now);
    const watch = f.store.due(now)[0];
    const scored = summary();
    f.store.checked(watch, scored, now, notificationFor(watch, scored, now, "https://aer.example/")!);
    const delivery = f.store.pending(now)[0];
    const token = new URLSearchParams(new URL(delivery.url!).hash.slice(1)).get("forecast")!;
    assert.ok(token);
    assert.deepEqual(f.store.view(token, now), { ...spot, alertEnabled: false });
    assert.equal(f.store.view(token, now + 7 * 86_400_000), null);
    assert.equal(f.store.view("invented", now), null);
    f.store.disconnect(owner);
    assert.equal(f.store.view(token, now), null);
  } finally { f.clean(); }
});

test("HTTP requires the owner cookie and same origin, rejects invalid rules, never accepts a browser chat ID", async () => {
  const f = fixture();
  const handler = createAlertHttp({ store: f.store, username: "aer_bot", publicUrl: "https://aer.example/", clock: () => now });
  const server = createServer((request, response) => { void handler(request, response); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/telegram`;
  const post = (path: string, body = {}, cookie = "", origin = "https://aer.example", method = "POST") => fetch(base + path, {
    method, headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await post("/connect", {}, "", "https://evil.example")).status, 403);
    const response = await post("/connect");
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
    const raw = await response.json();
    const token = new URL(raw.connectUrl).searchParams.get("start")!;
    assert.equal(raw.status.connected, false);
    f.store.applyUpdate({ update_id: 1, message: { message_id: 1, text: `/start ${token}`, chat: { id: 42, type: "private" }, from: { id: 42 } } }, now);
    assert.equal((await post("/spots", { spots: [spot], revision: 0, chatId: 99 }, cookie, "https://aer.example", "PUT")).status, 200);
    assert.equal(f.store.due(now)[0].chatId, 42);
    assert.equal((await post("/spots", { spots: [], revision: 0 }, cookie, "https://aer.example", "PUT")).status, 409);
    assert.equal((await post("/spots", { spots: [{ ...spot, criteria: { ...spot.criteria, maxSwellPeriod: 1 } }], revision: 1 }, cookie, "https://aer.example", "PUT")).status, 400);
    assert.equal((await fetch(base + "/spot?id=bukit")).status, 404);
    assert.equal((await fetch(base + "/spot?id=bukit", { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await post("/disconnect", {}, cookie)).status, 200);
    assert.equal(f.store.due(now).length, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); f.clean(); }
});


test("Telegram monitoring uses sliding rules, persists them, and rejects scattered matches", () => {
  const f = fixture();
  try {
    const { owner } = connect(f.store);
    const configured = { ...spot, alertRules: [{ minDays: 2, withinDays: 4 }, { minDays: 4, withinDays: 7 }] };
    f.store.sync(owner, [configured], 0);
    assert.deepEqual(f.store.spot(owner, spot.id)?.alertRules, configured.alertRules);
    const watch = f.store.due(now)[0];
    const scattered = summary(["2026-10-23", "2026-10-27", "2026-10-31", "2026-11-04"]);
    assert.equal(notificationFor(watch, scattered, now, "https://aer.example/"), null);
    const fourOnly = summary(["2026-10-24", "2026-10-25", "2026-11-01"]);
    const notification = notificationFor(watch, fourOnly, now, "https://aer.example/");
    assert.ok(notification);
    assert.match(notification.text, /Met: 2 matching days in a 4-day period; need 2/);
    assert.match(notification.text, /Not met: 2 matching days in a 7-day period; need 4/);
    assert.deepEqual(notification.dates, ["2026-10-24", "2026-10-25"]);
    const sevenOnly = notificationFor(watch, summary(["2026-10-24", "2026-10-27", "2026-10-28", "2026-10-29"]), now, "https://aer.example/");
    assert.ok(sevenOnly);
    assert.match(sevenOnly.text, /Met: 4 matching days in a 7-day period; need 4/);
    const later = summary(["2026-10-30", "2026-11-02", "2026-11-04", "2026-11-05"]);
    const sliding = notificationFor(watch, later, now, "https://aer.example/");
    assert.ok(sliding, "the screenshot's later qualifying period triggers Telegram too");
    assert.match(sliding.text, /30 Oct–5 Nov/);
    assert.equal(notificationFor(watch, { ...later, horizonDays: 7 }, now, "https://aer.example/"), null);

    // Mark an actual alert as delivered, then verify that losing the short-window match re-arms it.
    const welcome = f.store.pending(now)[0];
    f.store.beginDelivery(welcome, now); f.store.delivered(welcome, { kind: "sent", messageId: 1 }, now);
    f.store.checked(watch, fourOnly, now, notification);
    const delivery = f.store.pending(now)[0];
    f.store.beginDelivery(delivery, now); f.store.delivered(delivery, { kind: "sent", messageId: 2 }, now);
    const qualified = f.store.due(now + 21_600_001)[0];
    assert.equal(qualified.qualified, true);
    f.store.checked(qualified, scattered, now + 21_600_001);
    assert.equal(f.store.due(now + 43_200_002)[0].qualified, false, "scattered matches do not keep a sliding rule armed");
  } finally { f.clean(); }
});

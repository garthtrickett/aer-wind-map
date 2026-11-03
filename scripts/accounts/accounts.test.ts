import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultHistoryCriteria } from "../../src/history.ts";
import type { SavedSpot } from "../../src/saved-spots.ts";
import { createAccountHttp, cookieValue } from "./http.ts";
import { createAlertHttp } from "../alerts/http.ts";
import { openAlertStore } from "../alerts/store.ts";
import { hashSecret, linkLifetime, normalizeEmail, openAccountStore, sessionLifetime } from "./store.ts";
import { createResendMailer } from "./email.ts";
import { createAccountRuntime } from "./runtime.ts";

const spot = (id: string, links: readonly string[] = []): SavedSpot => ({
  id, name: id, point: { latitude: -8.7, longitude: 115.1 }, startYear: 2022, endYear: 2025,
  criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 2,
  alertRules: [{ minDays: 2, withinDays: 4 }], alertLookAheadDays: 14, linkedSpotIds: links,
  mapZoom: 13.75, shoreNormal: 219,
});
const login = (store: ReturnType<typeof openAccountStore>, email: string, now = 1_000_000, owner: string | null = null) =>
  store.consumeLink(store.issueLink(email, now), now, owner)!;

test("magic links are single use, previews do not consume them, sessions expire, and emails normalize", () => {
  const store = openAccountStore(":memory:");
  try {
    assert.equal(normalizeEmail("  Garth+surf@Example.COM "), "garth+surf@example.com");
    for (const email of ["bad", "a@b", "a@example.com\r\nBcc:x@example.com", null]) assert.equal(normalizeEmail(email), null);
    const now = 1000, token = store.issueLink("a@example.com", now);
    assert.equal(store.previewLink(token, now), "a@example.com");
    assert.equal(store.previewLink(token, now), "a@example.com");
    const account = store.consumeLink(token, now, null)!;
    assert.ok(account);
    assert.equal(store.consumeLink(token, now, null), null);
    assert.deepEqual(store.session(account.token, now), account.user);
    assert.equal(store.session(hashSecret(account.token), now), null);
    assert.equal(store.session(account.token, now + sessionLifetime), null);
    const expired = store.issueLink("b@example.com", now);
    assert.equal(store.consumeLink(expired, now + linkLifetime, null), null);
    store.logout(account.token);
    assert.equal(store.session(account.token, now), null);
  } finally { store.close(); }
});

test("account storage survives reopening and never exposes another user's spots", () => {
  const dir = mkdtempSync(join(tmpdir(), "aer-account-restart-"));
  const path = join(dir, "accounts.sqlite");
  let store = openAccountStore(path);
  try {
    const first = login(store, "first@example.com");
    const second = login(store, "second@example.com");
    assert.equal(store.replace(first.user.id, [spot("wind")], 0), true);
    assert.equal(store.replace(first.user.id, [], 0), false, "stale writes must not remove saved data");
    assert.deepEqual(store.data(second.user.id).spots, []);
    store.close(); store = openAccountStore(path);
    assert.deepEqual(store.session(first.token, 1_000_000), first.user);
    assert.deepEqual(store.data(first.user.id).spots, [spot("wind")]);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("browser import is atomic, repeatable once per source, and remaps colliding linked IDs without overwriting", () => {
  const store = openAccountStore(":memory:");
  try {
    const account = login(store, "a@example.com");
    store.replace(account.user.id, [{ ...spot("swell"), name: "Server's existing swell" }], 0);
    const incoming = [spot("wind", ["swell"]), spot("swell")];
    const original = JSON.stringify(incoming);
    const source = "00000000-0000-4000-8000-000000000000";
    assert.deepEqual(store.importBrowser(account.user.id, source, incoming, 1), { added: 2, alreadyImported: false });
    const data = store.data(account.user.id);
    assert.equal(data.spots.length, 3);
    assert.equal(data.spots[0].name, "Server's existing swell");
    const wind = data.spots.find((value) => value.id === "wind")!;
    const importedSwell = data.spots.find((value) => value.id !== "swell" && value.name === "swell")!;
    assert.deepEqual(wind.linkedSpotIds, [importedSwell.id]);
    assert.equal(wind.mapZoom, 13.75); assert.equal(wind.shoreNormal, 219);
    assert.deepEqual(wind.alertRules, incoming[0].alertRules);
    assert.equal(JSON.stringify(incoming), original);
    assert.deepEqual(store.importBrowser(account.user.id, source, incoming, 2), { added: 2, alreadyImported: true });
    assert.equal(store.data(account.user.id).revision, data.revision);
    assert.equal(store.data(account.user.id).spots.length, 3);
  } finally { store.close(); }
});

test("Telegram ownership can follow an account across devices but cannot be claimed by a second account", () => {
  const store = openAccountStore(":memory:");
  try {
    const first = login(store, "first@example.com", 1, "legacy-owner");
    const second = login(store, "second@example.com", 1, "legacy-owner");
    assert.equal(store.telegramOwner(first.user.id), "legacy-owner");
    assert.equal(store.telegramOwner(second.user.id), null);
    const otherDevice = login(store, "first@example.com", 2);
    assert.equal(otherDevice.user.id, first.user.id);
    assert.equal(store.telegramOwner(otherDevice.user.id), "legacy-owner");
  } finally { store.close(); }
});

test("HTTP rejects CSRF, unauthenticated writes, stale revisions, account switches, and replayed links", async () => {
  const store = openAccountStore(":memory:");
  const alerts = openAlertStore(":memory:");
  const messages: { email: string; link: string }[] = [];
  let handler: ReturnType<typeof createAccountHttp>;
  let alertHandler: ReturnType<typeof createAlertHttp>;
  const server = createServer((req, res) => { void (req.url?.startsWith("/api/telegram/") ? alertHandler : handler)(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  handler = createAccountHttp({ store, publicUrl: base, mailer: async (email, link) => { messages.push({ email, link }); } });
  alertHandler = createAlertHttp({ store: alerts, username: "aer_test_bot", publicUrl: base,
    accountFor: (req) => store.session(cookieValue(req, "aer_session"), Date.now())?.id ?? null });
  const call = (path: string, body?: object, cookie?: string, origin = base) => fetch(`${base}/api/account/${path}`, {
    method: body ? path === "spots" ? "PUT" : "POST" : "GET",
    headers: { Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    assert.equal((await call("request-link", { email: "a@example.com" }, undefined, "https://other.example")).status, 403);
    assert.equal(messages.length, 0);
    assert.equal((await call("spots", { spots: [], revision: 0 })).status, 401);
    assert.equal((await call("request-link", { email: "a@example.com" })).status, 202);
    const token = new URLSearchParams(new URL(messages[0].link).hash.slice(1)).get("login")!;
    assert.equal(new URL(messages[0].link).search, "", "login secrets must not appear in access-log query strings");
    assert.equal((await call("confirm-link")).status, 405, "GET must not sign in or consume a link");
    assert.equal((await call("preview-link", { token })).status, 200);
    const confirmed = await call("confirm-link", { token });
    const cookie = confirmed.headers.get("set-cookie")!.split(";")[0];
    assert.match(confirmed.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
    const first = await confirmed.json();
    assert.equal(first.user.email, "a@example.com");
    assert.equal((await call("confirm-link", { token })).status, 400);
    assert.equal((await call("spots", { userId: first.user.id, spots: [spot("private")], revision: 0 }, cookie)).status, 200);
    const stale = await call("spots", { userId: first.user.id, spots: [], revision: 0 }, cookie);
    assert.equal(stale.status, 409); assert.equal((await stale.json()).spots.length, 1);
    const other = login(store, "b@example.com", Date.now());
    const otherCookie = `aer_session=${other.token}`;
    const wrongTelegramAccount = await fetch(`${base}/api/telegram/connect`, { method: "POST", headers: {
      Origin: base, Cookie: otherCookie, "Content-Type": "application/json", "X-Aer-Account": first.user.id }, body: "{}" });
    assert.equal(wrongTelegramAccount.status, 401, "a stale account tab must not connect or sync another account's Telegram");
    const rightTelegramAccount = await fetch(`${base}/api/telegram/status`, { headers: { Cookie: otherCookie, "X-Aer-Account": other.user.id } });
    assert.equal(rightTelegramAccount.status, 200);
    assert.deepEqual((await (await call("session", undefined, otherCookie)).json()).spots, []);
    assert.equal((await call("spots", { userId: first.user.id, spots: [spot("leak")], revision: 0 }, otherCookie)).status, 401);
    const source = "00000000-0000-4000-8000-000000000000";
    assert.equal((await call("import", { userId: first.user.id, source, spots: [spot("leak")] }, otherCookie)).status, 401);
    assert.equal((await call("import", { userId: first.user.id, source, spots: [spot("swell")] }, cookie)).status, 200);
    assert.equal((await call("import", { userId: first.user.id, source, spots: [spot("swell")] }, cookie)).status, 200);
    assert.equal(store.data(first.user.id).spots.length, 2);
    assert.equal((await call("logout", { userId: first.user.id }, cookie)).status, 200);
    assert.equal((await (await call("session", undefined, cookie)).json()).user, null);
    for (let i = 0; i < 2; i++) assert.equal((await call("request-link", { email: "a@example.com" })).status, 202);
    assert.equal((await call("request-link", { email: "a@example.com" })).status, 429);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); alerts.close(); }
});

test("email provider errors fail closed and runtime never enables login without durable configuration", async () => {
  const mailer = createResendMailer("fake", "Aer <login@example.com>", async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.deepEqual(body.to, ["a@example.com"]);
    assert.equal(body.html, undefined, "plain text links do not require HTML interpolation");
    return new Response("provider failure", { status: 503 });
  });
  await assert.rejects(() => mailer("a@example.com", "https://aer.example/#login=secret"));
  const runtime = createAccountRuntime({}); runtime.stop();
  assert.throws(() => createAccountRuntime({ AER_ACCOUNT_DB: "relative.sqlite", PUBLIC_APP_URL: "https://aer.example" }));
  assert.throws(() => createAccountRuntime({ AER_ACCOUNT_DB: "/tmp/not-created.sqlite", PUBLIC_APP_URL: "https://aer.example/untrusted" }));
});

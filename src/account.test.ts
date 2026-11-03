import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountClient } from "./account.ts";
import { defaultHistoryCriteria } from "./history.ts";
import type { SavedSpot } from "./saved-spots.ts";
import type { AccountPanel, AccountSnapshot } from "./account-types.ts";

const spot = (name = "wind"): SavedSpot => ({ id: "wind", name, point: { latitude: -8.7, longitude: 115.1 },
  startYear: 2022, endYear: 2025, criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 1 });
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { values, storage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as unknown as Storage };
};
const response = (value: object, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const snapshot = (spots: readonly SavedSpot[] = []): AccountSnapshot => ({ available: true, emailEnabled: true,
  user: { id: "account-a", email: "a@example.com" }, spots, revision: 0, importedSources: [] });
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 2)); }
  assert.fail("Account operation did not finish");
};

test("sign-in never silently imports browser spots, and explicit import keeps the original bytes", async () => {
  const local = memoryStorage();
  const original = JSON.stringify({ version: 1, spots: [spot()] });
  local.storage.setItem("aer.saved-spots.v1", original);
  let panel: AccountPanel | null = null;
  let shown: readonly SavedSpot[] = [];
  let imports = 0;
  let server = snapshot();
  const client = createAccountClient({ storage: () => local.storage, changed: (next, spots) => { panel = next; if (spots) shown = spots; },
    fetcher: async (url, init) => {
      if (String(url).endsWith("session")) return response({ ...snapshot(), user: null });
      if (String(url).endsWith("preview-link")) return response({ email: "a@example.com" });
      if (String(url).endsWith("confirm-link")) return response(server);
      if (String(url).endsWith("import")) {
        const body = JSON.parse(init!.body as string);
        assert.equal(body.userId, "account-a"); assert.deepEqual(body.spots, [spot()]);
        imports++;
        server = { ...server, spots: body.spots, revision: 1, importedSources: [body.source] };
        return response({ ...server, added: 1 });
      }
      throw new Error("Unexpected request");
    } });
  await client.start("test-token");
  assert.equal(panel!.confirmEmail, "a@example.com");
  assert.equal(imports, 0);
  await client.action({ kind: "confirmLink" });
  assert.equal(shown.length, 0, "account starts with only its own server data");
  assert.equal(panel!.browserCount, 1); assert.equal(imports, 0);
  await client.action({ kind: "importBrowser" });
  assert.equal(shown.length, 1); assert.equal(panel!.imported, true);
  assert.equal(local.storage.getItem("aer.saved-spots.v1"), original);
});

test("rapid edits serialize and a failed save survives a reload without contaminating guest storage", async () => {
  const local = memoryStorage();
  const original = JSON.stringify({ version: 1, spots: [spot("Guest original")] });
  local.storage.setItem("aer.saved-spots.v1", original);
  let panel: AccountPanel | null = null;
  let remote = snapshot([spot()]);
  let offline = true;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("session")) return response(remote);
    if (offline) throw new Error("Network unavailable");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.userId, remote.user!.id);
    remote = { ...remote, revision: remote.revision + 1, spots: body.spots };
    return response(remote);
  };
  let client = createAccountClient({ storage: () => local.storage, fetcher, changed: (next) => { panel = next; } });
  await client.load();
  assert.equal(client.persist([spot("Offline edit")]).ok, true);
  await until(() => panel!.sync === "error");
  assert.ok(local.storage.getItem("aer.account.pending.v1.account-a"));
  assert.equal(local.storage.getItem("aer.saved-spots.v1"), original);
  offline = false;
  client = createAccountClient({ storage: () => local.storage, fetcher, changed: (next) => { panel = next; } });
  await client.load();
  await until(() => panel!.sync === "saved");
  assert.equal(remote.spots[0].name, "Offline edit");
  assert.equal(local.storage.getItem("aer.account.pending.v1.account-a"), null);
  assert.equal(local.storage.getItem("aer.saved-spots.v1"), original);
});

test("in-flight edits are not lost and conflicting updates do not overwrite the remote version", async () => {
  const local = memoryStorage();
  let remote = snapshot([spot()]);
  let panel: AccountPanel | null = null;
  let resolveFirst: (() => void) | null = null;
  let calls = 0;
  let forceConflict = false;
  const client = createAccountClient({ storage: () => local.storage, changed: (next) => { panel = next; }, fetcher: async (url, init) => {
    if (String(url).endsWith("session")) return response(remote);
    const body = JSON.parse(init!.body as string);
    if (++calls === 1) await new Promise<void>((resolve) => { resolveFirst = resolve; });
    if (forceConflict) { forceConflict = false; remote = { ...remote, spots: [spot("Other device")], revision: remote.revision + 1 }; }
    if (body.revision !== remote.revision) return response(remote, 409);
    remote = { ...remote, spots: body.spots, revision: remote.revision + 1 }; return response(remote);
  } });
  await client.load();
  client.persist([spot("First edit")]);
  await until(() => resolveFirst !== null);
  client.persist([spot("Latest edit")]);
  assert.equal(calls, 1, "only one write may be in flight");
  resolveFirst!();
  await until(() => panel!.sync === "saved");
  assert.equal(remote.spots[0].name, "Latest edit");
  forceConflict = true;
  client.persist([spot("My conflicting edit")]);
  await until(() => panel!.sync === "conflict");
  assert.equal(remote.spots[0].name, "Other device");
  await client.action({ kind: "keepLocal" });
  await until(() => panel!.sync === "saved");
  assert.equal(remote.spots[0].name, "My conflicting edit");
});

test("blocked device storage still shows account identity and server spots without erasing anything", async () => {
  let panel: AccountPanel | null = null;
  let shown: readonly SavedSpot[] = [];
  const client = createAccountClient({ storage: () => { throw new Error("Blocked"); }, fetcher: async () => response(snapshot([spot()])),
    changed: (next, spots) => { panel = next; if (spots) shown = spots; } });
  await client.load();
  assert.equal(panel!.user!.email, "a@example.com");
  assert.equal(shown.length, 1);
  assert.equal(client.persist([spot("Unsavable")]).ok, false);
});

test("a late preview from an earlier magic link cannot relabel a newer login token", async () => {
  const local = memoryStorage();
  let panel: AccountPanel | null = null;
  let release: ((value: Response) => void) | null = null;
  const client = createAccountClient({ storage: () => local.storage, changed: (next) => { panel = next; },
    fetcher: async (url, init) => {
      if (String(url).endsWith("session")) return response({ ...snapshot(), user: null });
      const body = JSON.parse(init!.body as string);
      if (String(url).endsWith("preview-link")) {
        if (body.token === "old") return await new Promise<Response>((resolve) => { release = resolve; });
        return response({ email: "new@example.com" });
      }
      assert.equal(body.token, "new");
      return response({ ...snapshot(), user: { id: "new", email: "new@example.com" } });
    } });
  const old = client.start("old");
  await until(() => release !== null);
  await client.start("new");
  release!(response({ email: "old@example.com" }));
  await old;
  assert.equal(panel!.confirmEmail, "new@example.com");
  await client.action({ kind: "confirmLink" });
  assert.equal(panel!.user!.email, "new@example.com");
});

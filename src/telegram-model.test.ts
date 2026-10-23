import assert from "node:assert/strict";
import { test } from "node:test";
import { initialTelegram, presentTelegram } from "./telegram-model.ts";
import { disconnectedTelegram } from "./telegram-types.ts";

test("initial status never erases existing server monitors; connecting explicitly queues a sync", () => {
  let panel = presentTelegram(initialTelegram, { kind: "telegramRequested", action: "status" });
  panel = presentTelegram(panel, { kind: "telegramLoaded", id: 1, reply: { status: {
    ...disconnectedTelegram, available: true, connected: true, revision: 5, spotCount: 3,
  } } });
  assert.equal(panel.request, null);
  assert.equal(panel.syncedKey, null);
  const connecting = { ...initialTelegram, connectUrl: "https://t.me/aer_bot?start=example", request: { action: "status" as const, id: 3, started: true, key: "[]" }, sequence: 3 };
  panel = presentTelegram(connecting, { kind: "telegramLoaded", id: 3, reply: { status: panel.status } });
  assert.equal(panel.request?.action, "sync");
});

test("an edit during a sync queues the latest snapshot; stale responses cannot replace it", () => {
  let panel = { ...initialTelegram, status: { ...disconnectedTelegram, available: true, connected: true } };
  panel = presentTelegram(panel, { kind: "telegramSpotsChanged", key: "first", edited: true });
  const first = panel.request!;
  panel = presentTelegram(panel, { kind: "telegramStarted", id: first.id, key: "first" });
  panel = presentTelegram(panel, { kind: "telegramSpotsChanged", key: "second", edited: true });
  panel = presentTelegram(panel, { kind: "telegramLoaded", id: first.id, reply: { status: { ...panel.status, revision: 1 } } });
  assert.equal(panel.syncedKey, "first");
  assert.equal(panel.request?.action, "sync");
  assert.equal(panel.request?.key, "second");
  const newer = panel;
  panel = presentTelegram(panel, { kind: "telegramFailed", id: first.id, message: "old error" });
  assert.equal(panel, newer);
});

test("failed sync stays unsynced without a rapid retry loop", () => {
  let panel = { ...initialTelegram, status: { ...disconnectedTelegram, available: true, connected: true } };
  panel = presentTelegram(panel, { kind: "telegramSpotsChanged", key: "edited", edited: true });
  panel = presentTelegram(panel, { kind: "telegramFailed", id: panel.request!.id, message: "Try again" });
  assert.equal(panel.syncedKey, null);
  assert.equal(panel.wantSync, false);
  assert.equal(panel.request, null);
  assert.equal(panel.error, "Try again");
});

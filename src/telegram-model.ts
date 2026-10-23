import type { SavedSpot } from "./saved-spots.ts";
import { disconnectedTelegram, type TelegramReply, type TelegramStatus } from "./telegram-types.ts";

export type TelegramAction = "status" | "connect" | "sync" | "test" | "disconnect";
export type TelegramPanel = Readonly<{
  status: TelegramStatus;
  loaded: boolean;
  request: Readonly<{ action: TelegramAction; id: number; started: boolean; key: string }> | null;
  sequence: number;
  localKey: string;
  syncedKey: string | null;
  wantSync: boolean;
  connectUrl: string | null;
  expiresAt: number | null;
  message: string | null;
  error: string | null;
}>;
export const initialTelegram: TelegramPanel = {
  status: disconnectedTelegram, loaded: false, request: null, sequence: 0,
  localKey: "[]", syncedKey: null, wantSync: false, connectUrl: null, expiresAt: null, message: null, error: null,
};
export const telegramSpots = (spots: readonly SavedSpot[]): readonly SavedSpot[] => spots.filter((spot) => spot.alertEnabled);
export const telegramSpotsKey = (spots: readonly SavedSpot[]): string => JSON.stringify(telegramSpots(spots));
export type TelegramProposal =
  | Readonly<{ kind: "telegramRequested"; action: TelegramAction }>
  | Readonly<{ kind: "telegramStarted"; id: number; key: string }>
  | Readonly<{ kind: "telegramLoaded"; id: number; reply: TelegramReply }>
  | Readonly<{ kind: "telegramFailed"; id: number; message: string }>
  | Readonly<{ kind: "telegramLinkFailed" }>
  | Readonly<{ kind: "telegramSpotsChanged"; key: string; edited: boolean }>
  | Readonly<{ kind: "telegramSyncRemembered"; key: string | null }>;

const request = (panel: TelegramPanel, action: TelegramAction): TelegramPanel => ({
  ...panel, sequence: panel.sequence + 1,
  request: { action, id: panel.sequence + 1, started: false, key: panel.localKey }, error: null, message: null,
});
const next = (panel: TelegramPanel): TelegramPanel => panel.wantSync && panel.status.connected && !panel.request
  ? request(panel, "sync") : panel;
export const presentTelegram = (panel: TelegramPanel, proposal: TelegramProposal): TelegramPanel => {
  switch (proposal.kind) {
    case "telegramLinkFailed": return { ...panel, error: "This forecast link expired or its alert was removed. For an older link, use the original browser connected to Telegram." };
    case "telegramSyncRemembered": return { ...panel, syncedKey: proposal.key };
    case "telegramSpotsChanged": return next({ ...panel, localKey: proposal.key,
      wantSync: panel.wantSync || (proposal.edited && panel.status.connected) });
    case "telegramRequested":
      if (panel.request || (proposal.action !== "status" && proposal.action !== "connect" && !panel.status.connected)) return panel;
      return request(panel, proposal.action);
    case "telegramStarted": return panel.request?.id === proposal.id
      ? { ...panel, request: { ...panel.request, started: true, key: proposal.key } } : panel;
    case "telegramFailed": return panel.request?.id === proposal.id
      ? { ...panel, loaded: true, request: null, wantSync: false, error: proposal.message } : panel;
    case "telegramLoaded": {
      if (panel.request?.id !== proposal.id) return panel;
      const action = panel.request.action;
      const justConnected = proposal.reply.status.connected && !panel.status.connected && !!panel.connectUrl;
      const syncedKey = action === "sync" ? panel.request.key : panel.syncedKey;
      return next({ ...panel, status: proposal.reply.status, request: null, loaded: true, syncedKey,
        connectUrl: proposal.reply.status.connected || action === "disconnect" ? null : proposal.reply.connectUrl ?? panel.connectUrl,
        expiresAt: proposal.reply.status.connected || action === "disconnect" ? null : proposal.reply.expiresAt ?? panel.expiresAt,
        wantSync: proposal.reply.status.connected && (justConnected || (action === "sync"
          ? syncedKey !== panel.localKey : panel.wantSync)), error: null,
        message: action === "test" ? "Test queued. Check Telegram; delivery status updates here."
          : action === "sync" ? "Enabled saved spots synced. Checks continue with the app closed."
            : action === "disconnect" ? "Disconnected. Server alerts for this browser have stopped." : panel.message,
      });
    }
  }
};

export const telegramRequest = async (action: TelegramAction, spots: readonly SavedSpot[], revision: number): Promise<TelegramReply> => {
  const response = await fetch(`/api/telegram/${action === "sync" ? "spots" : action}`, {
    method: action === "status" ? "GET" : action === "sync" ? "PUT" : "POST",
    credentials: "same-origin", signal: AbortSignal.timeout(15_000),
    ...(action === "status" ? {} : { headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "sync" ? { spots: telegramSpots(spots), revision } : {}) }),
  });
  const raw = await response.json();
  if (!response.ok) throw new Error(typeof raw.error === "string" ? raw.error : "Telegram request failed. Try again.");
  if (!raw.status || typeof raw.status.available !== "boolean" || typeof raw.status.connected !== "boolean" ||
    !Number.isSafeInteger(raw.status.revision)) throw new Error("Telegram returned an incomplete response.");
  return raw;
};

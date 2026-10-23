import type { SavedSpot } from "./saved-spots.ts";

export type TelegramStatus = Readonly<{
  available: boolean;
  connected: boolean;
  pending: boolean;
  revision: number;
  spotCount: number;
  lastCheckedAt: number | null;
  lastSentAt: number | null;
  issue: "forecast" | "delivery" | "uncertain" | "blocked" | null;
}>;
export type TelegramReply = Readonly<{
  status: TelegramStatus;
  connectUrl?: string;
  expiresAt?: number;
  spot?: SavedSpot;
}>;

export const disconnectedTelegram: TelegramStatus = {
  available: false, connected: false, pending: false, revision: 0, spotCount: 0,
  lastCheckedAt: null, lastSentAt: null, issue: null,
};

import { isSavedSpot, type SavedSpot } from "./saved-spots.ts";

export type AccountUser = Readonly<{ id: string; email: string }>;
export type AccountSnapshot = Readonly<{
  available: boolean;
  emailEnabled: boolean;
  user: AccountUser | null;
  spots: readonly SavedSpot[];
  revision: number;
  importedSources: readonly string[];
}>;
export const validAccountSpots = (value: unknown): value is readonly SavedSpot[] =>
  Array.isArray(value) && value.length <= 2000 && value.every(isSavedSpot) &&
  new Set(value.map((spot) => spot.id)).size === value.length;

export type AccountPanel = Readonly<{
  phase: "checking" | "guest" | "signedIn" | "unavailable";
  emailEnabled: boolean;
  user: AccountUser | null;
  busy: boolean;
  sync: "idle" | "saving" | "saved" | "error" | "conflict";
  browserCount: number;
  browserInvalid: boolean;
  imported: boolean;
  confirmEmail: string | null;
  message: string | null;
  error: string | null;
}>;
export const initialAccount: AccountPanel = {
  phase: "checking", emailEnabled: false, user: null, busy: false, sync: "idle",
  browserCount: 0, browserInvalid: false, imported: false, confirmEmail: null, message: null, error: null,
};
export type AccountAction =
  | Readonly<{ kind: "requestLink"; email: string }>
  | Readonly<{ kind: "confirmLink" | "importBrowser" | "logout" | "refresh" | "retrySync" | "useServer" | "keepLocal" }>;

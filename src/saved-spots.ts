import type { HistoryCriteria } from "./history.ts";
import { lastCompleteHistoryYear, validCriteria, type Point } from "./model.ts";

export type SavedSpot = Readonly<{
  id: string;
  name: string;
  point: Point;
  startYear: number;
  endYear: number;
  criteria: HistoryCriteria;
  alertEnabled: boolean;
  alertMinDays: number;
}>;

export type SavedSpotsError = Readonly<{ kind: "invalid" | "unavailable" }>;
export type SavedSpotsResult =
  | Readonly<{ ok: true; value: readonly SavedSpot[] }>
  | Readonly<{ ok: false; error: SavedSpotsError }>;
export type SaveResult = Readonly<{ ok: true }> | Readonly<{ ok: false; error: SavedSpotsError }>;

type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;
const storageKey = "aer.saved-spots.v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSavedSpot = (value: unknown): value is SavedSpot => {
  if (!isRecord(value) || !isRecord(value.point) || !isRecord(value.criteria)) return false;
  const { latitude, longitude } = value.point;
  return typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
    typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 80 &&
    typeof value.alertEnabled === "boolean" &&
    Number.isInteger(value.alertMinDays) && (value.alertMinDays as number) >= 1 && (value.alertMinDays as number) <= 14 &&
    typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    Number.isInteger(value.startYear) && (value.startYear as number) >= 2022 &&
    Number.isInteger(value.endYear) && (value.endYear as number) <= lastCompleteHistoryYear &&
    (value.endYear as number) >= (value.startYear as number) && (value.endYear as number) - (value.startYear as number) <= 4 &&
    validCriteria(value.criteria as HistoryCriteria);
};

export const readSavedSpots = (storage: StorageAccess): SavedSpotsResult => {
  let text: string | null;
  try { text = storage().getItem(storageKey); }
  catch { return { ok: false, error: { kind: "unavailable" } }; }
  if (text === null) return { ok: true, value: [] };
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.spots)) {
      return { ok: false, error: { kind: "invalid" } };
    }
    const spots = raw.spots.map((spot: unknown) => {
      if (!isRecord(spot) || !isRecord(spot.criteria) || "maxSwellPeriod" in spot.criteria) return spot;
      return { ...spot, criteria: { ...spot.criteria, maxSwellPeriod: null } };
    });
    if (!spots.every(isSavedSpot) || new Set(spots.map((spot) => spot.id)).size !== spots.length) {
      return { ok: false, error: { kind: "invalid" } };
    }
    return { ok: true, value: spots };
  } catch { return { ok: false, error: { kind: "invalid" } }; }
};

export const writeSavedSpots = (storage: StorageAccess, spots: readonly SavedSpot[]): SaveResult => {
  try {
    storage().setItem(storageKey, JSON.stringify({ version: 1, spots }));
    return { ok: true };
  } catch { return { ok: false, error: { kind: "unavailable" } }; }
};

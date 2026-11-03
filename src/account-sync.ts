import { validAccountSpots } from "./account-types.ts";
import type { SavedSpot } from "./saved-spots.ts";

const equal = (a: SavedSpot | undefined, b: SavedSpot | undefined) => JSON.stringify(a) === JSON.stringify(b);
export const mergeAccountSpots = (base: readonly SavedSpot[], local: readonly SavedSpot[], remote: readonly SavedSpot[]): readonly SavedSpot[] | null => {
  const before = new Map(base.map((spot) => [spot.id, spot]));
  const ours = new Map(local.map((spot) => [spot.id, spot]));
  const theirs = new Map(remote.map((spot) => [spot.id, spot]));
  const ids = new Set([...remote.map((spot) => spot.id), ...local.map((spot) => spot.id), ...before.keys()]);
  const result: SavedSpot[] = [];
  for (const id of ids) {
    const old = before.get(id), left = ours.get(id), right = theirs.get(id);
    const chosen = equal(left, old) ? right : equal(right, old) || equal(left, right) ? left : null;
    if (chosen === null) return null;
    if (chosen) result.push(chosen);
  }
  return result;
};

export type PendingAccountSpots = Readonly<{ revision: number; base: readonly SavedSpot[]; spots: readonly SavedSpot[] }>;
const cacheKey = (user: string) => `aer.account.pending.v1.${user}`;
export const readPendingAccountSpots = (storage: Storage, user: string): PendingAccountSpots | null => {
  const text = storage.getItem(cacheKey(user));
  if (!text) return null;
  const raw = JSON.parse(text) as PendingAccountSpots;
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0 || !validAccountSpots(raw.base) || !validAccountSpots(raw.spots))
    throw new Error("Unreadable unsynced account data. Download a browser backup before clearing storage.");
  return raw;
};
export const writePendingAccountSpots = (storage: Storage, user: string, value: PendingAccountSpots | null): void => {
  if (value) storage.setItem(cacheKey(user), JSON.stringify(value));
  else storage.removeItem(cacheKey(user));
};

export const browserImportSource = (storage: Storage): string => {
  const key = "aer.browser-import-source.v1";
  const old = storage.getItem(key);
  if (old && /^[a-f0-9-]{36}$/.test(old)) return old;
  const source = crypto.randomUUID(); storage.setItem(key, source); return source;
};

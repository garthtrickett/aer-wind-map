import type { SavedSpot } from "./saved-spots.ts";

export const validSpotLinks = (ids: unknown): ids is readonly string[] =>
  Array.isArray(ids) && ids.length <= 49 && new Set(ids).size === ids.length &&
  ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100);

/** AND is idempotent: reciprocal links and shared dependencies are visited once. */
export const linkedSpotGroup = (root: SavedSpot, catalog: readonly SavedSpot[]) => {
  const pending = [root];
  const spots = new Map<string, SavedSpot>();
  const missing = new Set<string>();
  while (pending.length) {
    const spot = pending.shift()!;
    if (spots.has(spot.id)) continue;
    spots.set(spot.id, spot);
    for (const id of spot.linkedSpotIds ?? []) {
      const peer = id === root.id ? root : catalog.find((item) => item.id === id);
      if (!peer) missing.add(id);
      else if (!spots.has(id)) pending.push(peer);
    }
    if (spots.size > 50) return { spots: [...spots.values()], missing: ["Too many linked spots"] };
  }
  return { spots: [...spots.values()], missing: [...missing] };
};

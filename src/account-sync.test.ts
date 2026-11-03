import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHistoryCriteria } from "./history.ts";
import type { SavedSpot } from "./saved-spots.ts";
import { mergeAccountSpots } from "./account-sync.ts";

const spot = (id: string, name = id): SavedSpot => ({ id, name, point: { latitude: 0, longitude: 0 },
  startYear: 2022, endYear: 2025, criteria: defaultHistoryCriteria, alertEnabled: false, alertMinDays: 1 });
test("independent device changes merge, preserving deletes and new linked spots", () => {
  const base = [spot("wind"), spot("swell"), spot("remove")];
  const local = [{ ...spot("wind", "New wind name"), linkedSpotIds: ["swell"] }, spot("swell")];
  const remote = [spot("wind"), spot("swell", "New swell name"), spot("remove"), spot("new")];
  assert.deepEqual(mergeAccountSpots(base, local, remote), [local[0], remote[1], remote[3]]);
});
test("same-spot conflicts and edit-versus-delete conflicts require a choice", () => {
  const base = [spot("wind")];
  assert.equal(mergeAccountSpots(base, [spot("wind", "A")], [spot("wind", "B")]), null);
  assert.equal(mergeAccountSpots(base, [], [spot("wind", "B")]), null);
  assert.deepEqual(mergeAccountSpots(base, [spot("wind", "A")], [spot("wind", "A")]), [spot("wind", "A")]);
});

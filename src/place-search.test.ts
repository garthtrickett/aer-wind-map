import assert from "node:assert/strict";
import { test } from "node:test";
import { searchPlaces, type Place } from "./place-search.ts";
import { initialState, present, nap, type State } from "./model.ts";
import type { SavedSpot } from "./saved-spots.ts";

const place: Place = { name: "San Juan", label: "San Juan, La Union, Philippines", point: { latitude: 16.67, longitude: 120.34 }, zoom: 12 };
const searchState = (): State => ({ ...initialState, placeSearch: { ...initialState.placeSearch, available: true } });
const readySearch = (state: State): State => {
  state = present(state, { kind: "placeSearchQueryChanged", query: "San Juan La Union" });
  state = present(state, { kind: "placeSearchRequested" });
  state = present(state, { kind: "placeSearchStarted", request: state.placeSearch.request });
  return present(state, { kind: "placeSearchCompleted", request: state.placeSearch.request, result: { ok: true, places: [place] } });
};

test("place lookup encodes the full query, validates coordinates and disambiguates results", async () => {
  let requested: URL | null = null;
  const feature = { text: "San Juan", place_name: place.label, center: [120.34, 16.67], place_type: ["municipality"] };
  const result = await searchPlaces("  San Juan / La Union & Philippines  ", "test-key", new AbortController().signal, (async (input) => {
    requested = new URL(String(input));
    return Response.json({ features: [feature, feature, null, { ...feature, center: [190, 15] },
      { ...feature, center: [120, null] }, { ...feature, center: [120, 89] },
      { ...feature, place_name: "San Juan, Puerto Rico", center: [-66, 18] }] });
  }) as typeof fetch);
  assert.ok(result.ok);
  assert.deepEqual(result.places, [place, { ...place, label: "San Juan, Puerto Rico", point: { longitude: -66, latitude: 18 } }]);
  assert.equal(requested!.hostname, "api.maptiler.com");
  assert.equal(decodeURIComponent(requested!.pathname), "/geocoding/San Juan / La Union & Philippines.json");
  assert.equal(requested!.searchParams.get("autocomplete"), "false");
  assert.equal(requested!.searchParams.get("limit"), "5");
});

test("invalid searches do not request data; empty, failed and malformed replies remain distinct", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json({ features: [] }); }) as typeof fetch;
  const signal = new AbortController().signal;
  assert.equal((await searchPlaces(" ", "key", signal, fetcher)).ok, false);
  assert.equal((await searchPlaces("La Union", "", signal, fetcher)).ok, false);
  assert.equal(calls, 0);
  assert.deepEqual(await searchPlaces("Not a place", "key", signal, fetcher), { ok: true, places: [] });
  assert.deepEqual(await searchPlaces("La Union", "key", signal, (async () => new Response(null, { status: 429 })) as typeof fetch),
    { ok: false, message: "Place search is busy. Wait a moment and try again." });
  assert.equal((await searchPlaces("La Union", "key", signal, (async () => Response.json({ wrong: [] })) as typeof fetch)).ok, false);
});

test("typing alone never searches and superseded responses cannot replace a newer query", () => {
  let state = present(searchState(), { kind: "placeSearchQueryChanged", query: "San Juan" });
  assert.notEqual(nap(state)?.kind, "searchPlaces");
  state = present(state, { kind: "placeSearchRequested" });
  const request = state.placeSearch.request;
  assert.deepEqual(nap(state), { kind: "searchPlaces", query: "San Juan", request });
  state = present(state, { kind: "placeSearchStarted", request });
  const changed = present(state, { kind: "placeSearchQueryChanged", query: "Kudat" });
  assert.equal(present(changed, { kind: "placeSearchCompleted", request, result: { ok: true, places: [place] } }), changed);
});

test("choosing a place creates the forecast marker without changing saved spots", () => {
  const state = readySearch(searchState());
  assert.equal(present(state, { kind: "placeSearchResultSelected", index: -1 }), state);
  const selected = present(state, { kind: "placeSearchResultSelected", index: 0 });
  assert.deepEqual(selected.selected, place.point);
  assert.equal(selected.modalOpen, false);
  assert.equal(selected.placeSearch.phase, "idle");
  assert.equal(selected.savedSpots, state.savedSpots);
  assert.deepEqual(selected.dayLookup.point, place.point);
});

test("moving an edited saved marker preserves settings and links, invalidates old data, and waits for save", () => {
  const original: SavedSpot = { id: "coastal-wind", name: "Coastal wind", point: { latitude: 15, longitude: 119 },
    criteria: { ...initialState.history.criteria, conditions: "wind" }, startYear: 2024, endYear: 2025,
    alertEnabled: true, alertMinDays: 2, alertRules: [{ minDays: 2, withinDays: 4 }], linkedSpotIds: ["offshore-swell"] };
  const opened = present({ ...searchState(), savedSpots: [original] }, { kind: "savedSpotOpened", id: original.id });
  const state = readySearch(opened);
  const moved = present(state, { kind: "placeSearchResultSelected", index: 0 });
  assert.equal(moved.history.open, true);
  assert.equal(moved.history.savedSpotId, original.id);
  assert.equal(moved.history.criteria, original.criteria);
  assert.deepEqual(moved.history.linkedSpotIds, original.linkedSpotIds);
  assert.equal(moved.history.saveName, original.name);
  assert.deepEqual(moved.history.point, place.point);
  assert.equal(moved.history.phase, "needsData");
  assert.equal(moved.history.data, null);
  assert.ok(moved.history.forecastPreview.request > state.history.forecastPreview.request);
  assert.ok(moved.compassForecast.request > state.compassForecast.request);
  assert.equal(moved.savedSpots[0], original);
  const saved = present(moved, { kind: "savedSpotSaved", id: original.id });
  assert.deepEqual(saved.savedSpots[0].point, place.point);
});

test("details stay open on relocation; leaving or moving a marker invalidates pending searches", () => {
  const state = readySearch({ ...searchState(), selected: { latitude: 10, longitude: 110 }, modalOpen: true });
  const moved = present(state, { kind: "placeSearchResultSelected", index: 0 });
  assert.equal(moved.modalOpen, true);
  assert.deepEqual(moved.selected, place.point);
  const cleared = present(state, { kind: "selectionCleared" });
  assert.equal(cleared.placeSearch.phase, "idle");
  assert.equal(cleared.placeSearch.places.length, 0);
  assert.ok(cleared.placeSearch.request > state.placeSearch.request);
});

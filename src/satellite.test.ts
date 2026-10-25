import assert from "node:assert/strict";
import test from "node:test";
import { loadSatellite, mapTilerTileJson } from "./satellite.ts";
import { initialState, nap, present } from "./model.ts";

const metadata = { tiles: ["https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg?key=test-only"],
  attribution: "© MapTiler © Imagery provider", minzoom: 0, maxzoom: 22 };
const fixture = (value: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(value), { status });

test("satellite is opt-in and an unconfigured key does not enable it", async () => {
  assert.equal(mapTilerTileJson(undefined), null);
  assert.equal(mapTilerTileJson(" "), null);
  const url = mapTilerTileJson("test-only")!;
  assert.equal(new URL(url).searchParams.get("key"), "test-only");
  assert.equal(present(initialState, { kind: "basemapSelected", basemap: "satellite" }), initialState);
  const result = await loadSatellite(url, fixture(metadata));
  assert.ok(result.ok);
  assert.equal(result.data.maxZoom, 22);
  assert.equal(result.data.tileSize, 256);
  for (const value of [{ ...metadata, tiles: ["https://unexpected.example/{z}/{x}/{y}.jpg"] },
    { ...metadata, maxzoom: -1 }, { ...metadata, tiles: [] }, { ...metadata, tileSize: 12 }]) {
    assert.equal((await loadSatellite(url, fixture(value))).ok, false);
  }
  const failure = await loadSatellite(url, fixture({}, 403));
  assert.equal(failure.ok, false);
  assert.ok(!JSON.stringify(failure).includes("test-only"));
});

test("basemap changes preserve the weather, selection and history; late metadata does not switch the map", async () => {
  const result = await loadSatellite(mapTilerTileJson("test-only")!, fixture(metadata));
  const original = present({ ...initialState, satellite: { ...initialState.satellite, available: true } },
    { kind: "locationSelected", point: { latitude: -8.7, longitude: 115.27 } });
  let state = present(original, { kind: "basemapSelected", basemap: "satellite" });
  assert.equal(nap(state)?.kind, "loadSatellite");
  assert.equal(state.weatherOverlay, false);
  assert.equal(state.selected, original.selected);
  assert.equal(state.field, original.field);
  assert.equal(state.history, original.history);
  state = present(state, { kind: "satelliteStarted" });
  state = present(state, { kind: "basemapSelected", basemap: "map" });
  state = present(state, { kind: "satelliteCompleted", result });
  assert.equal(state.basemap, "map");
  assert.equal(state.satellite.phase, "ready");
  state = present(state, { kind: "basemapSelected", basemap: "satellite" });
  assert.equal(state.satellite.phase, "ready");
  assert.equal(state.weatherOverlay, false);
  state = present(state, { kind: "weatherOverlayChanged", visible: true });
  assert.equal(state.weatherOverlay, true);
  state = present(state, { kind: "satelliteTilesFailed" });
  assert.equal(state.basemap, "map");
  assert.equal(state.weatherOverlay, true);
  assert.equal(state.satellite.data, null);
});

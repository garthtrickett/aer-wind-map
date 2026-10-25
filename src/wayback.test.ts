import assert from "node:assert/strict";
import test from "node:test";
import { loadWayback, waybackImagery, waybackEnabled, type WaybackClient } from "./wayback.ts";
import { selectedCapture } from "./wayback-model.ts";
import { initialState, present, nap } from "./model.ts";

const point = { latitude: -8.7, longitude: 115.267 };
const release = (id: number, date: string) => ({ releaseNum: id, releaseDateLabel: date,
  itemURL: `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${id}/{level}/{row}/{col}` });
const metadata = (date: string) => ({ date: Date.parse(date), provider: "Vantor", source: "WV03", resolution: .3 });
const client: WaybackClient = {
  getWaybackItemsWithLocalChanges: async () => [release(3, "2026-09-24"), release(2, "2026-05-28"), release(1, "2024-06-06")],
  getMetadata: async (_point, _zoom, id) => id === 1 ? metadata("2023-03-18") : { ...metadata("2025-05-01"), provider: id === 2 ? "Maxar" : "Vantor", resolution: id === 2 ? .6 : .3 },
};
const result = () => loadWayback(point, 18, new AbortController().signal, async () => client);

test("Wayback dates are local capture dates, duplicate captures collapse to the latest release, and tile axes are correct", async () => {
  const r = await result(); assert.ok(r.ok);
  assert.equal(r.data.captures.length, 2);
  const [capture] = r.data.captures;
  assert.equal(capture.captured, "2025-05-01");
  assert.equal(capture.released, "2026-09-24");
  assert.equal(capture.release, 3);
  const layer = waybackImagery(capture);
  assert.equal(layer.provider, "esri");
  assert.ok(layer.tiles[0].endsWith("/3/{z}/{y}/{x}"));
  assert.ok(layer.attribution.includes("Vantor"));
});

test("partial or missing metadata retains unknown captures without inventing a capture date or zero resolution", async () => {
  const r = await loadWayback(point, 18, new AbortController().signal, async () => ({ ...client,
    getMetadata: async (_point, _zoom, id) => {
      if (id === 3) throw new Error("Service unavailable");
      if (id === 2) return null;
      return { ...metadata("2023-03-18"), resolution: -99999 };
    } }));
  assert.ok(r.ok);
  assert.equal(r.data.captures.length, 3);
  assert.equal(r.data.metadataFailures, 1);
  assert.equal(r.data.captures.find(c => c.release === 3)?.captured, null);
  assert.equal(r.data.captures.find(c => c.release === 1)?.resolution, null);
});

test("untrusted imagery hosts, invalid locations and failed catalogues cannot become layers", async () => {
  for (const itemURL of ["https://other.example/{level}/{row}/{col}", release(3,"2026-09-24").itemURL.replace("/tile/3/", "/tile/8/")]) {
    const r = await loadWayback(point, 18, new AbortController().signal, async () => ({ ...client,
      getWaybackItemsWithLocalChanges: async () => [{ ...release(3,"2026-09-24"), itemURL }] }));
    assert.equal(r.ok, false);
  }
  assert.equal((await loadWayback({ latitude: NaN, longitude: 3 }, 18, new AbortController().signal)).ok, false);
  assert.equal((await loadWayback(point, 9, new AbortController().signal)).ok, false);
  const r = await loadWayback(point, 18, new AbortController().signal, async () => ({ ...client,
    getWaybackItemsWithLocalChanges: async () => { throw new Error("Offline"); } }));
  assert.equal(r.ok, false);
});

test("aborting a stalled metadata read finishes the request instead of waiting indefinitely", async () => {
  const controller = new AbortController();
  const pending = loadWayback(point, 18, controller.signal, async () => ({ ...client,
    getMetadata: async () => new Promise(() => {}) }));
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  assert.equal((await pending).ok, false);
});

test("history is opt-in, follows location/detail changes, rejects stale responses and leaves weather time unchanged", async () => {
  assert.equal(waybackEnabled(undefined), false);
  assert.equal(waybackEnabled("false"), false);
  assert.equal(waybackEnabled("true"), true);
  assert.equal(present(initialState, {kind:"basemapSelected",basemap:"wayback"}), initialState);
  let state = { ...initialState, wayback: { ...initialState.wayback, available:true } };
  state = present(state, {kind:"imageryViewportChanged",center:point,zoom:18});
  state = present(state, {kind:"basemapSelected",basemap:"wayback"});
  assert.equal(nap(state)?.kind,"loadWayback");
  const first=state.wayback.request;
  state=present(state,{kind:"waybackStarted",request:first});
  state=present(state,{kind:"locationSelected",point:{...point,longitude:115.3}});
  assert.equal(state.wayback.phase,"needsData");
  state=present(state,{kind:"waybackCompleted",request:first,result:await result()});
  assert.equal(state.wayback.data,null);
  const next=state.wayback.request;
  state=present(state,{kind:"waybackStarted",request:next});
  state=present(state,{kind:"waybackCompleted",request:next,result:await result()});
  assert.equal(selectedCapture(state.wayback)?.release,3);
  state=present(state,{kind:"waybackCaptureSelected",release:1});
  assert.equal(selectedCapture(state.wayback)?.captured,"2023-03-18");
  assert.equal(state.step,initialState.step);
  assert.equal(state.dayLookup.date,initialState.dayLookup.date);
  state=present(state,{kind:"imageryViewportChanged",center:point,zoom:17});
  assert.equal(state.wayback.phase,"needsData");
  const late=state.wayback.request;
  state=present(state,{kind:"waybackStarted",request:late});
  state=present(state,{kind:"basemapSelected",basemap:"map"});
  state=present(state,{kind:"waybackCompleted",request:late,result:await result()});
  assert.equal(state.basemap,"map");
  assert.equal(state.weatherOverlay,true);
  assert.equal(state.wayback.data,null);
});

test("a late regular-satellite failure does not exit the imagery-history layer", () => {
  let state={...initialState, satellite:{...initialState.satellite,available:true}, wayback:{...initialState.wayback,available:true}};
  state=present(state,{kind:"basemapSelected",basemap:"satellite"});
  state=present(state,{kind:"satelliteStarted"});
  state=present(state,{kind:"basemapSelected",basemap:"wayback"});
  state=present(state,{kind:"satelliteCompleted",result:{ok:false,message:"Unavailable"}});
  assert.equal(state.basemap,"wayback");
  assert.equal(state.weatherOverlay,false);
});

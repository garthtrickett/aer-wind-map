import assert from "node:assert/strict";
import { test } from "node:test";
import { observationDirection, parseCwaBuoys, parseCwaCountyWind, parseCwaWindSites, parseMetars, parseNdbcNames, parseNdbcObservations, withinObservationBounds } from "./observations.ts";
import { initialObservations, observationEffect, presentObservations } from "./observations-model.ts";
import { createObservationFeed, parseObservationQuery } from "../scripts/observations.ts";
import { distanceToTaiwanCoastKm, includeTaiwanWindStation, nearTaiwanCoast } from "./taiwan-coast.ts";

test("CWA wave measurements keep their local time, zeroes, missing fields and quality flags", () => {
  const [station] = parseCwaBuoys([{ stid: "46761F", state: "on", stnae: "Chenggong Wave Station", lat: "23.1325", lon: "121.4201",
    dtime: "2026-10-19T13:00:00", WH: "0", WH_qc: "Q", WP: "5.4", WP_qc: "Q", WDIR: "98", WDIR_qc: "Q",
    SWIND: "", SWIND_qc: "", GUST: "9", GUST_qc: "X", fcst_wh: "3.5", marker_wh: "3.5" }]);
  assert.equal(station?.waveHeight, 0);
  assert.equal(station?.wavePeriod, 5.4);
  assert.equal(station?.waveFrom, 98);
  assert.equal(station?.windSpeed, null);
  assert.equal(station?.gust, null);
  assert.equal(station?.observedAt, "2026-10-19T05:00:00.000Z");
  assert.deepEqual(parseCwaBuoys([{ state: "on", WH: 3 }]), []);
});

test("METAR wind parses raw knots/mps, variable direction, calm and north correctly", () => {
  const entry = { icaoId: "WADD", obsTime: 1792389600, lat: -8.748, lon: 115.167, wspd: 99, wdir: 0 };
  const read = (rawOb: string) => parseMetars([{ ...entry, rawOb }])[0]!;
  const variable = read("METAR WADD 190600Z VRB02KT 9999");
  assert.equal(variable.variableWind, true);
  assert.equal(variable.windFrom, null);
  assert.ok(Math.abs(variable.windSpeed! * 3.6 - 3.704) < 0.01);
  const north = read("METAR WADD 190600Z 36004G12KT 9999");
  assert.equal(north.windFrom, 0);
  assert.ok(Math.abs(north.gust! - 6.173328) < 0.000001);
  assert.equal(read("METAR WADD 190600Z 00000KT 9999").windFrom, null);
  assert.equal(read("METAR WADD 190600Z 29003MPS 9999").windSpeed, 3);
});

test("NDBC columns distinguish significant height and dominant/mean periods without turning missing values into zero", () => {
  const names = parseNdbcNames('<stations><station id="41001" lat="34" name="TEST &amp; BUOY"/></stations>');
  const [station] = parseNdbcObservations('#STN LAT LON\n41001 34.00 -72.00 2026 10 19 05 00 360 0.0 MM 1.8 15 9.2 220 1010 MM 25', names);
  assert.equal(station?.name, "TEST & BUOY · 41001");
  assert.equal(station?.waveHeight, 1.8);
  assert.equal(station?.wavePeriod, 15);
  assert.equal(station?.meanPeriod, 9.2);
  assert.equal(station?.waveFrom, 220);
  assert.equal(station?.windFrom, null);
  assert.equal(station?.gust, null);
});

test("CWA county wind uses station coordinates and handles the New Year rollover without executing the script", () => {
  assert.equal(observationDirection(337.5), "NNW");
  assert.equal(observationDirection(70), "ENE");
  const sites = parseCwaWindSites([{ ID: "46761", eSTname: "Chengkung", STname: "成功", CountyID: "10014", Lat: "23.097486", Lon: "121.373428", eItem: "Rain, Wind, WindDir" }]);
  const script = `var ST = {'10014':{'0':{'StationStatus':'1','StationID':'46761','Date':'12/31','Time':'23:50',
    'WindDir':{'C':'西北','E':'NW'},'Wind':{'MS':{'C':'1.2','E':'1.2'}},'Gust':{'MS':{'C':'-','E':'-'}}}}};`;
  const [station] = parseCwaCountyWind(script, sites, Date.parse("2026-01-01T00:10:00+08:00"));
  assert.equal(station?.windFrom, 315);
  assert.equal(station?.windSpeed, 1.2);
  assert.equal(station?.latitude, 23.097486);
  assert.equal(station?.observedAt, "2025-12-31T15:50:00.000Z");
  assert.equal(station?.gust, null);
  assert.deepEqual(parseCwaCountyWind('globalThis.bad = true', sites, Date.now()), []);
});

test("observation loading ignores late results after moving or disabling a layer", () => {
  const bounds = { south: 22, west: 120, north: 24, east: 122 };
  let state = presentObservations(initialObservations, { kind: "observationViewportChanged", bounds, zoom: 8 });
  assert.equal(observationEffect(state), null);
  state = presentObservations(state, { kind: "observationLayerToggled", layer: "buoys" });
  const effect = observationEffect(state)!;
  state = presentObservations(state, { kind: "observationsStarted", key: effect.key });
  const moved = presentObservations(state, { kind: "observationViewportChanged", bounds: { ...bounds, south: 21 }, zoom: 8 });
  const data = { stations: [], issues: [], fetchedAt: "2026-10-19T06:00:00Z" };
  assert.equal(presentObservations(moved, { kind: "observationsLoaded", key: effect.key, data }), moved);
  const disabled = presentObservations(state, { kind: "observationLayerToggled", layer: "buoys" });
  assert.equal(observationEffect(disabled), null);
  assert.equal(presentObservations(disabled, { kind: "observationsLoaded", key: effect.key, data }), disabled);
});

test("query validation bounds provider calls and supports views crossing the date line", () => {
  assert.equal(parseObservationQuery(new URLSearchParams('south=-90&north=90&west=-180&east=180&buoys=true&wind=true')), null);
  assert.equal(parseObservationQuery(new URLSearchParams('south=abc&north=24&west=120&east=122&buoys=true&wind=false')), null);
  const query = parseObservationQuery(new URLSearchParams('south=-10&north=10&west=170&east=-170&buoys=true&wind=false'))!;
  assert.equal(withinObservationBounds({ latitude: 0, longitude: 179 }, query.bounds), true);
  assert.equal(withinObservationBounds({ latitude: 0, longitude: -179 }, query.bounds), true);
  assert.equal(withinObservationBounds({ latitude: 0, longitude: 0 }, query.bounds), false);
});

test("server shares in-flight cached reads and isolates a failed provider", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes('aviationweather')) return new Response('unavailable', { status: 503 });
    return new Response(url.includes('activestations') ? '<stations/>'
      : '#STN LAT LON\n41001 34.00 -72.00 2026 10 19 05 00 90 4.0 MM 1.8 15 9.2 220 1010 MM 25');
  };
  const feed = createObservationFeed(fetcher, () => Date.parse('2026-10-19T06:00:00Z'));
  const query = { bounds: { south: 33, west: -73, north: 35, east: -71 }, buoys: true, wind: true };
  const [first, second] = await Promise.all([feed(query), feed(query)]);
  assert.equal(calls.length, 3);
  assert.equal(first.stations.length, 1);
  assert.deepEqual(first.stations, second.stations);
  assert.equal(first.issues[0]?.source, 'Airport METAR');
});

test("coastal distance retains surf-coast and island stations but excludes inland valleys and lake shores", () => {
  for (const [latitude, longitude] of [[22.972672, 121.303986], [23.020333, 121.323642], [23.097486, 121.373428],
    [22.752, 121.154], [26.152, 119.949], [22.672, 121.49], [22.04, 121.55]]) {
    assert.equal(nearTaiwanCoast({ latitude, longitude }), true, `${latitude},${longitude} should be coastal`);
  }
  assert.equal(nearTaiwanCoast({ latitude: 25.037, longitude: 121.514 }), false, "Taipei is inland");
  assert.equal(nearTaiwanCoast({ latitude: 23.85, longitude: 120.91 }), false, "Sun Moon Lake is not the sea coast");
  assert.equal(distanceToTaiwanCoastKm({ latitude: NaN, longitude: 121 }), Infinity);
});

test("coastal wind filtering applies to Taiwan land and airport winds, preserving sea and other countries", () => {
  const [taipei] = parseMetars([{ icaoId: "RCSS", name: "Taipei", lat: 25.07, lon: 121.55,
    obsTime: 1792389600, rawOb: "METAR RCSS 190600Z 36004KT" }]);
  assert.equal(includeTaiwanWindStation(taipei!, true), false);
  assert.equal(includeTaiwanWindStation(taipei!, false), true);
  assert.equal(includeTaiwanWindStation({ ...taipei!, id: "metar:WADD" }, true), true);
  assert.equal(includeTaiwanWindStation({ ...taipei!, kind: "buoy", source: "CWA" }, true), true);
  assert.equal(includeTaiwanWindStation({ ...taipei!, id: "cwa-wind:46692", source: "CWA" }, true), false);
});

test("coastal toggle is default-on, changes the request and rejects a late inland-inclusive response", () => {
  let state = presentObservations(initialObservations, { kind: "observationViewportChanged", bounds: { south: 22, north: 26, west: 120, east: 122 }, zoom: 7 });
  state = presentObservations(state, { kind: "observationLayerToggled", layer: "wind" });
  const coastal = observationEffect(state);
  assert.ok(coastal?.kind === "loadObservations" && coastal.query.taiwanCoastalWind);
  state = presentObservations(state, { kind: "taiwanCoastalWindToggled" });
  const inland = observationEffect(state);
  assert.ok(inland?.kind === "loadObservations" && inland.query.taiwanCoastalWind === false);
  state = presentObservations(state, { kind: "observationsStarted", key: inland.key });
  state = presentObservations(state, { kind: "taiwanCoastalWindToggled" });
  assert.equal(presentObservations(state, { kind: "observationsLoaded", key: inland.key,
    data: { stations: [], issues: [], fetchedAt: "2026-10-19T00:00:00Z" } }), state);
  const params = new URLSearchParams("south=22&north=26&west=120&east=122&wind=true&buoys=false");
  assert.equal(parseObservationQuery(params)?.taiwanCoastalWind, true);
  params.set("taiwanCoastalWind", "false"); assert.equal(parseObservationQuery(params)?.taiwanCoastalWind, false);
  params.set("taiwanCoastalWind", "yes"); assert.equal(parseObservationQuery(params), null);
});

test("server coastal selection filters CWA sites before county loading and can restore inland sites", async () => {
  const coordinates = [
    { ID: "C0S81", eSTname: "Donghe", STname: "東河", CountyID: "10014", Lat: "22.972672", Lon: "121.303986", eItem: "Wind, WindDir" },
    { ID: "46692", eSTname: "Taipei", STname: "臺北", CountyID: "63", Lat: "25.037", Lon: "121.514", eItem: "Wind, WindDir" },
  ];
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes("STMap.json")) return Response.json(coordinates);
    if (url.includes("County/")) {
      const station = url.includes("10014") ? "C0S81" : "46692";
      return new Response(`var ST = {'0':{'StationStatus':'1','StationID':'${station}','Date':'10/19','Time':'08:00',
        'WindDir':{'E':'NNW'},'Wind':{'MS':{'C':'1.2'}},'Gust':{'MS':{'C':'-'}}}};`);
    }
    return new Response(url.includes("aviationweather") ? "[]" : url.includes("activestations") ? "<stations/>" : "#STN LAT LON\n");
  };
  const feed = createObservationFeed(fetcher, () => Date.parse("2026-10-19T02:00:00Z"));
  const query = { bounds: { south: 22, north: 26, west: 120, east: 122 }, wind: true, buoys: false };
  const coastal = await feed(query);
  assert.deepEqual(coastal.stations.map((station) => station.id), ["cwa-wind:C0S81"]);
  assert.equal(calls.some((url) => url.includes("County/63.js")), false);
  const all = await feed({ ...query, taiwanCoastalWind: false });
  assert.equal(all.stations.length, 2);
  assert.deepEqual(all.issues, []);
});

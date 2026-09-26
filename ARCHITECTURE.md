# Aer architecture

## Agreed first release

- A global, interactive map with a quiet OpenStreetMap-derived base layer.
- ECMWF IFS Open Data at 0.25-degree resolution, fetched directly by the browser.
- Wind speed color over the whole visible map, including after a location is
  selected. Animated arrows point and move toward the wind's destination.
- Clicking the map leaves a marker and opens a modal with 10 m wind speed,
  meteorological direction (where wind comes from), maximum gust over its stated
  preceding period, forecast valid time, and coordinates.
- A legend and forecast-time control keep the color, arrows, and modal on the
  same model run and valid time.

## Coding decisions

- Authored code is TypeScript. Use functions and object arguments. Application
  code has no classes; classes internal to Leaflet or the decoder are external
  library implementation details.
- State is immutable by default. Keep mutable typed arrays and animation
  bookkeeping inside the decoder and renderer implementations.
- Use a SAM loop: proposals enter `present`, which returns the next state;
  `lit-html` builds the view; a pure `nap` decides which explicit effects to
  start. Async actions return typed proposals. No action imports the loop.
- Use concrete `ok`/`error` discriminated results and tagged error unions at
  network and decode seams, following the Notes and Gafu V2 patterns. Add a
  generic result helper only if concrete result types become repetitive.
- Leaflet owns map interaction. MapLibre renders OpenFreeMap Positron vector
  tiles when WebGL2 is available; otherwise Leaflet loads OSM raster tiles.
  Two canvas layers draw wind color and arrows above the map. The animation
  loop does not dispatch a SAM proposal
  on every frame; user choices and completed loads do.
- The data source is ECMWF's official AWS Open Data mirror. Read `.index` rows,
  request `10u`, `10v`, and optional `10fg` by GRIB2 byte range, then decode in a
  Web Worker. Select a complete forecast run and retain its identity in every
  request so late responses cannot replace a newer selection.

## Decoder evaluation, 2026-09-26

The approved prototype dependency is `@meri-imperiumi/eccodes-wasm@2.48.2`.
Against the 2026-09-25 12 UTC IFS step-24 forecast, Chromium and Firefox
workers fetched the index with HTTP 200 and the `10u` field with HTTP 206,
then decoded a 1,440 by 721 (`1,038,240` value) `grid_ccsds` field. Both
reported the same first value, `-6.154754638671875` m/s. A separate Chromium
check decoded both `10u` and `10v`; each had the expected grid shape.

The package's WASM asset is 39,582,405 bytes (about 6.8 MB with gzip in the
local test). Browser integration required loading its Emscripten script and
CommonJS wrapper inside a classic worker. Node 22 could not compile this WASM;
the package declares Node 24 or later. Browser-worker decoding was therefore
used as the acceptance test. The exact ECMWF URL is in a rolling archive and
will expire; repeat the test against a current run during implementation.

## Verification

Unit tests cover date-line sampling, source direction, run URLs, stale worker
responses, and forecast time. Live Chromium and Firefox checks load a current
forecast through the production static server, select a map point, change
forecast time, close details with Escape, and exercise the mobile layout.
WebKit passed the same browser check. For the 2026-09-25 18 UTC step-3 run,
native ecCodes and the browser worker agreed exactly on first `10u` and `10v`
values, and on `10fg` within Float32 rounding. Both reported a 1,440 by 721
grid with the first point at 90° N, 180° E; all three fields reported zero
missing points. The worker maps future missing sentinels to `NaN`, so samples
show no invented speed or gust. The browser check also blocks the decoder
script once and verifies that Retry creates a new worker. Emulated mobile
loads took 5–9 seconds on this Linux host during checks. Physical iOS Safari
and real-device memory use remain unmeasured.

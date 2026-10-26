# Aer architecture

## Agreed first release

- A global, interactive map with a quiet OpenStreetMap-derived base layer.
- ECMWF IFS Open Data at 0.25-degree resolution, fetched directly by the browser.
- Wind speed color over the whole visible map, including after a location is
  selected. Animated arrows point and move toward the wind's destination.
- Clicking the map places a flag with the current 10 m wind speed and source
  direction. Dragging its card or point changes the selected location. Clicking
  the card or amber button opens a modal with wind speed, meteorological
  direction (where wind comes from), maximum gust over its stated preceding
  period, forecast valid time, and coordinates. The dismiss button removes the
  selection.
- A legend and forecast-time control keep the color, arrows, and modal on the
  same model run and valid time.
- A Wind/Waves switch selects ECMWF's combined wind waves and swell height
  (`swh`) and mean wave period (`mwp`) from the `wave` stream. Wave map color
  shows height, while the flag and modal also show period. The free feed does
  not supply first swell partition (`swh1`/`mwp1`) fields.
- A selected point's history panel compares swell-specific height, period, and
  source direction with wind speed and source direction. Swell period has an
  inclusive minimum and optional inclusive maximum; a blank maximum has no
  upper limit. The same matcher serves history, CSV exports, and forecast alerts.
  Each direction filter
  runs clockwise from its first bearing to its second, including north-crossing
  ranges. It ranks calendar months over up to
  five complete years by the fraction of usable days with a configurable
  consecutive-hour window between 06:00 (inclusive) and 18:00 (exclusive) in
  the spot's local timezone, then lists matching dates and exports hourly CSV.
  CSV match flags apply the same time restriction; full-day values remain
  available in the export and for the 18-paired-hour coverage check.
  The history panel shows a separate noninteractive Leaflet map centered on
  the selected point. SVG sectors and draggable bearing handles update the
  same immutable criteria as the numeric controls; the local map is created
  and removed explicitly when the panel opens and closes. Its zoom slider
  controls Leaflet directly and does not change history criteria or trigger
  archive requests. Both maps allow zoom level 20; raster layers enlarge native
  level-19 tiles at the closest zoom.
- Named spot presets store point, historical years, criteria, alert opt-in,
  and minimum matching days in browser local storage. Leaflet markers and a
  map list reopen the preset. Storage parsing and writes return typed errors.
  Older presets without a maximum swell period load with no upper limit.
- The forecast alert requests Météo-France MFWAM primary swell and ECMWF IFS 10 m wind through
  Open-Meteo for opted-in spots. It joins hourly instants, scores consecutive
  matches by each spot's local calendar day, and shows an on-screen alert
  when the number of matching days reaches the saved threshold.

## Coding decisions

- Place lookup is an independent SAM feature: `place-search.ts` validates bounded
  MapTiler geocoding results, `place-search-model.ts` owns explicit submissions and
  request generations, and `place-search-view.ts` is shared by the map and marker
  dialogs. It reuses the configured browser MapTiler key and supplies source
  attribution. Typing never starts a request. Query changes, dismissal and marker
  navigation abort/invalidate pending requests. Decimal latitude/longitude pairs
  are parsed locally, retain full precision and move the flag/camera on submission
  through the same relocation path; coordinate entry also works without a key.
  Malformed or out-of-range pairs leave the marker unchanged. Place names
  move the flag only after choosing a current result. Relocating a saved marker
  preserves the editor's settings and links, invalidates weather/history for its old point,
  and updates persistent presets/Telegram only through the existing save action.

- The optional regular satellite basemap uses a domain-restricted browser
  MapTiler key configured at build time. No key means no satellite control or
  MapTiler requests. Metadata loads on first selection and stays in memory;
  errors restore street view. MapLibre adds a raster source/layer to the existing
  style and preserves original street-layer visibility, leaving the custom
  weather layer and particle canvas intact. The Canvas fallback replaces only
  Leaflet's base tile layer. Background changes preserve camera and markers;
  Satellite hides weather graphics by default and offers an overlay checkbox.
  The imagery's provider credits and MapTiler logo accompany the active layer.

- Esri imagery history is an independent, optional basemap. `wayback.ts` loads
  the official `@esri/wayback-core` client lazily, finds changes for a point and
  integer detail level, queries acquisition metadata with four bounded workers,
  and deduplicates reported acquisition date and source combinations. Unknown dates
  keep their release identity. Service timeouts and partial metadata failures
  are explicit. The SDK does not propagate cancellation to every internal fetch;
  bounded waits and request generations discard stale results, while already
  started upstream reads may finish. Nothing is persisted or proxied.
  `wayback-model.ts` owns viewport, target, request generation and date choice;
  `wayback-view.ts` labels capture and release dates separately. Searches require
  zoom 10+, cap archive detail at 19, debounce gestures, and use a selected pin
  or map center. Loading/error states restore the street background. Imagery
  sources have distinct generations so an old tile error cannot break a newer
  date. Both renderers retain camera, markers and weather layers; source credits
  change with the provider. The build flag defaults off until the operator has
  confirmed appropriate Esri usage rights.

- The particular-day lookup is separate from seasonal scoring and forecast
  alerts. `day-lookup.ts` requests one local calendar day of ECMWF IFS wind and
  MFWAM swell/combined waves, joins sources by UTC instant and preserves nulls
  and per-source failures. Wind is requested in km/h. `day-lookup-model.ts`
  owns date, hour range and request generation; marker or date changes discard
  stale results and abort superseded browser requests. Hour edits only filter
  loaded data. The same `day-lookup-view.ts` appears in point details and saved
  marker panels, with spot-local timezone and each source's actual grid cell.

- The marker compass has independent forecast state in `compass-forecast-model.ts`.
  `history-mini-map.ts` owns the clipped Leaflet map, satellite metadata cache,
  provider credits outside the circle, and local street fallback. It uses the
  existing MapTiler configuration and decoder, without changing the main map's
  selected background. Removing it guards late metadata replies from touching
  the replacement marker. The zoom control and bearing overlay are independent
  of imagery loading.
  The circular-map zoom is draft SAM state in `history.mapZoom`, validated by
  shared map settings and persisted as optional `SavedSpot.mapZoom` on save.
  Older presets default to 11. Zoom changes preserve downloaded forecast/history
  data and alert keys; opening each preset restores its own saved zoom.
  Opening a marker loads enabled wind/swell sources through the existing forecast
  decoder, without opting into alerts. Marker/type changes abort and invalidate
  old requests; criteria and time-mode changes reuse downloaded data. A minute
  clock keeps Now on the current hour and refreshes data after 15 minutes.
  Map-time mode follows the global forecast's valid instant. Exact hourly UTC
  joins preserve missing values and partial failures. `compass-forecast-view.ts`
  labels source, valid time and directional fit; `history-compass.ts` draws solid
  configured wedges and read-only dashed from-bearing rays. No incoming forecast
  mutates criteria, historical scores or saved presets.

- Matching-day conditions are derived by `forecast-window.ts` from the existing
  preview data and the exact UTC interval returned by alert scoring. Each linked
  point keeps its enabled source and its own values. The shared exact-timestamp
  reader preserves nulls and converts m/s to km/h; compass lookups retain their
  existing hour rounding. `forecast-window-view.ts` displays per-window numeric
  ranges and distinct forecast compass sectors, with expandable hourly tables in
  the root spot's timezone. No direction averaging, new fetch, scoring change or
  summary payload expansion is involved.

- Observations are separate immutable SAM state and effects. Map move-end
  events propose the visible bounds; enabled observation layers load only a
  bounded area at zoom 5+. Late responses from an earlier view are rejected.
  Leaflet markers follow map transforms; animation frames never request data.
- Taiwan wind stations default to a coastal-only selection (roughly 5 km from
  the ocean). A SAM proposal changes the checkbox and request key, rejecting
  older responses from a different selection. CWA sites are filtered before
  county requests; Taiwan airport observations are filtered after decoding.
  Buoy winds and other countries' stations are unaffected. Distance is computed
  on the server against bundled Natural Earth 1:10m shoreline segments, with
  islands included and no additional runtime request or dependency.
- The existing Node server provides a fixed-source observation endpoint with
  a bounded in-memory cache and shared in-flight reads. NDBC supplies marine
  reports, AviationWeather supplies airport METARs, and CWA supplies Taiwan
  wave measurements, station metadata and public county wind reports. CWA's
  county JavaScript data is parsed as quoted fields, never executed. Failures
  remain visible per source. No forecast is substituted for an observation.
- Observation cards distinguish UTC instants (Taiwan source timestamps carry
  UTC+8), browser-local display time, old reports, calm/variable wind, reported
  compass sectors, significant wave height and provider period definitions.
  The forecast slider does not change observation times.
- NOWPHAS supplies Japanese wave-gauge and GPS-buoy metadata/current readings.
  Only its wave-enabled sites are shown; tide-only sensors are excluded.
  CWA's accessible archive station list adds historical sites even when a
  current observation is unavailable. Such markers have no observation time
  and show an archive symbol, never a synthetic current reading.
- A station's Wave history tab has its own immutable proposals and explicit
  fetch/download effects, separate from model history. Request keys include
  station identity and local date; late results cannot replace a newer choice.
  The Node/Vite endpoint downloads official measured archives on demand.
  NOWPHAS fixed-width data preserves its quality flags, JST instants and
  significant-wave period; CWA CSV converts centimetres and tenths of seconds
  and retains peak versus mean periods in UTC+8. Missing or calm direction
  values are not interpreted as north. CSV records both UTC and station-local
  time. No interpolation, forecast fallback or monthly seasonal score is
  applied to measured records.
- Archive ZIPs (including NOWPHAS's nested regional monthly ZIPs) are parsed
  in memory using Node's built-in deflate reader and bounded member sizes.
  CWA station/year and NOWPHAS station/year or provisional station/month reads
  share in-flight requests and use an eight-entry, six-hour cache. Fixed source
  destinations and catalogue validation prevent arbitrary upstream URLs.
  NOWPHAS's publication limit is extracted as data from its navigation script,
  never executed; unpublished dates return an explicit unavailable result.

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
  A custom MapLibre WebGL layer renders wind color into a texture at 40% of
  the map canvas dimensions, then composites it with the vector map. It
  updates that texture when the map view or forecast changes. A WebGL particle
  canvas draws animated arrow glyphs from the wind-vector texture. It shares
  MapLibre's map pane and copies the map canvas's zoom transform, so colors,
  arrows, and geography move together during zoom. Without WebGL2, the two
  overlays use Canvas 2D, with color stored at sampling resolution. A separate
  DOM flag follows Leaflet's projected point. Pointer movement on the flag
  proposes location changes. Animation frames do not dispatch SAM proposals;
  user choices and completed loads do.
- The data source is ECMWF's Google Cloud Open Data mirror. Read `.index` rows,
  request `10u`, `10v`, and optional `10fg` from `oper`, or `swh` and `mwp` from
  `wave`, by GRIB2 byte range, then decode in a Web Worker. Select a complete
  forecast run for the active stream and retain its identity in every
  request so late responses cannot replace a newer selection.
- Keep forecast instants in UTC internally and format timeline, run, and point
  details times in the browser's local timezone.
- Historical data is a separate on-demand browser effect. Open-Meteo Marine
  supplies Météo-France MFWAM swell height/period/direction from the selected sea cell;
  Open-Meteo Archive supplies ECMWF IFS 10 m wind speed/direction from its sea
  cell. Join by Unix timestamp, assign days using the marine response's IANA
  timezone, and keep the returned cell coordinates visible. Every historical
  response carries a request key so a moved point or changed year range cannot
  accept stale results. Criteria changes rescore the cached hourly series
  without a new request. Days with fewer than 18 paired hours are excluded
  from the monthly denominator.
- Forecast alert requests are batched, keyed by spot and criteria, and use a
  generation number to discard late responses after a preset changes. Checks
  refresh about every six hours while the page is open and retry failures
  sooner. The alert card can be dismissed without disabling checks.

## Telegram monitoring

`src/forecast-alerts.ts` shares scoring between browser cards and the server.
It joins wind/swell instants, filters 06:00–18:00 local and returns qualifying
dates and first windows. Validation lives with shared history criteria rather
than importing the browser state/view graph.
MFWAM requests cover 10 days; wind requests retain 15 days. Both return hourly
samples (MFWAM's native three-hour outputs are interpolated upstream). A saved
look-ahead may remain 14 days, but later unpaired dates are unknown, never
filled from GFS or extrapolated. Source identity and the swell forecast limit
are shared by the preview, alert card and Telegram message.

`scripts/alerts/store.ts` owns SQLite transactions for hashed browser sessions,
one-use connection links, enabled snapshots, revisions, scheduling, Telegram's
update cursor, worker lease and delivery attempts. `monitor.ts` applies forecast
and deduplication policy; `telegram.ts` owns credentials and transport results.
`http.ts` authenticates same-origin settings requests and bounds inputs.
`runtime.ts` verifies bot identity and runs the leased background loop in
production and Vite. Server checks need no browser timer or webhook.

Notification links use expiring read-only capabilities in URL fragments. Opening
one cannot change monitors or silently import presets. Owner cookies are HttpOnly
and never appear in links. Telegram has no send idempotency key; uncertain attempts
are held visibly instead of claimed as guaranteed delivery or repeated on restart.

`src/telegram-model.ts` integrates connection/sync effects with the SAM loop.
Only successfully persisted local edits trigger automatic sync. Revisions reject
stale tabs; an initial empty store never bulk-erases monitors. Users can stop
all installations linked to their private chat with `/stop`. The production
image includes shared TypeScript modules; SQLite must use a persistent volume.

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
forecast through the production static server, select a map point, drag the
flag, open and close details, change forecast time, and exercise the mobile
layout. A Chromium mobile check also drags the flag with emulated touch.
WebKit passed the same browser check. For the 2026-09-25 18 UTC step-3 run,
native ecCodes and the browser worker agreed exactly on first `10u` and `10v`
values, and on `10fg` within Float32 rounding. Both reported a 1,440 by 721
grid with the first point at 90° N, 180° E; all three fields reported zero
missing points. The worker maps future missing sentinels to `NaN`, so samples
show no invented speed or gust. The browser check also blocks the decoder
script once and verifies that Retry creates a new worker. Emulated mobile
loads took 5–9 seconds on this Linux host during checks. A one-field-set
Chromium diagnostic measured a 64 MiB WASM heap plus 12.5 MB of decoded U, V,
and gust arrays. Physical iOS Safari and total real-device memory use remain
unmeasured.

The zoom smoke check also verifies that the particle canvas takes the same
transform as MapLibre's canvas, that arrows keep changing during zoom, and
that reduced-motion arrows stay still. Chromium checks the low-resolution
Canvas 2D fallback. Headless zoom frame timings vary on this shared host;
physical-device smoothness remains to be measured.


## Linked forecast conditions

`HistoryCriteria.conditions` is an optional `both | swell | wind` selector;
legacy presets default to both. Single-source history and forecast requests
skip the unused provider and score coverage using only required fields.
`SavedSpot.linkedSpotIds` adds AND dependencies without changing each point's
own OR day-count rows. `spot-links.ts` resolves a bounded graph, deduplicating
reciprocal links. Missing references remain visible and fail closed.

The shared forecast evaluator intersects raw UTC hourly matches across the
resolved points before constructing daily windows. Intersecting only each
point's first daily window would miss later overlapping sessions. The group
uses the greatest required consecutive-hour count, the shortest configured
look-ahead, and local daylight at every point. Each member's rules evaluate the
joint days; notifications require all members and shared qualifying dates.
Draft previews cache the group's raw forecasts; link/source changes discard
old requests. Alert identity includes every dependency's criteria and rules,
so changing or removing a peer invalidates an older result.

Telegram sync sends the closure of enabled roots, including disabled linked
conditions. SQLite stores all snapshots, but only enabled roots become watches
or count as enabled monitors. Each worker batch resolves links within one
owner's catalog. In-flight results and delivery acknowledgements carry a group
identity so a peer edit cannot mark an old forecast current or suppress a fresh
alert. The nullable `deliveries.group_key` column is added idempotently to
existing databases. Capability views return read-only linked snapshots;
these live in the history panel until the user explicitly saves a preset.


`HistoryCriteria.calmWindKmh` sets an inclusive direction exception (0–10 km/h,
default 2 for both new and legacy presets; 0 disables it). `windIsCalm` converts
the threshold to m/s before comparison. Shared availability and matching accept
a missing wind direction only when known wind speed is calm. Wind speed and
swell bounds still apply. All history and forecast consumers use that matcher,
and alert keys include the saved threshold through criteria. Map pin text,
colors, saved-list labels and tooltips derive from `criteria.conditions` rather
than storing a separate marker type that could drift from the forecast checks.

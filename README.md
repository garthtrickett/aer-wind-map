# Aer — global wind forecast

Aer shows ECMWF IFS 10 m wind on a global OpenStreetMap-derived map. Color covers
the visible world, and arrows move toward the wind's destination. Click the map
to place a wind flag, drag the flag to inspect another point, and click its card
or amber button to open wind speed, source direction, gust, forecast time, and
coordinates. The timeline steps through the first 72 forecast hours. Displayed
times use the browser's local timezone.

## Run locally

Node 22.12 or newer is needed for Vite. The deployment image uses Node 24.

```sh
npm ci
npm run dev
```

For a production build and live browser check:

```sh
npm test
npm run build
npm run smoke:live
BROWSER=firefox npm run smoke:live
BROWSER=webkit npm run smoke:live
```

`npm run build` copies the approved ecCodes WASM decoder, bundles its worker,
and compresses the WASM file for the production server. `node scripts/serve.ts`
serves `dist` on `$PORT` (default 3000); `GET /health` responds with `ok`.
The Dockerfile builds and runs the same static server on Railway.

The browser fetches ECMWF's `.index` and GRIB2 byte ranges directly from its
official AWS Open Data mirror. No ECMWF key or weather proxy is needed.
MapLibre renders OpenFreeMap Positron vector tiles where WebGL2 is available;
Leaflet uses standard OpenStreetMap raster tiles as a fallback. Source credits
stay visible on the map.
Wind color uses a reduced-size texture in a MapLibre WebGL layer. Animated
arrows use a second WebGL canvas that follows the map's zoom transform. Browsers
without WebGL2 use reduced-resolution Canvas 2D color and arrows.

## Limits

- ECMWF keeps a rolling archive, so Aer selects the newest reachable run with
  its 72-hour file available. A new run may appear after the page was opened;
  reload to select it.
- Each forecast step downloads three compressed global fields, and first use
  downloads a 39.6 MB WASM decoder (about 6.8 MB over the network with gzip).
  In one Chromium step-3 check, its WASM heap was 64 MiB and the three decoded
  arrays totaled 12.5 MB, before map and browser overhead. Decoding and
  animation can be demanding on older phones.
- Gusts are shown as unavailable if the gust field cannot be fetched or decoded.
- Browser checks cover Chromium, Firefox, and WebKit desktop/mobile on Linux.
  Physical iOS Safari, older phones, and actual zoom frame rates on hardware
  have not been measured.

See [ARCHITECTURE.md](ARCHITECTURE.md) for data and state boundaries.

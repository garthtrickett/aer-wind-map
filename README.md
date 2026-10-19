# Aer — global wind and wave forecast

Aer shows ECMWF IFS 10 m wind on a global OpenStreetMap-derived map. Color covers
the visible world, and arrows move toward the wind's destination. The main map
zooms to level 20 for close inspection of streets and coastlines. Click the map
to place a wind flag, drag the flag to inspect another point, and click its card
or amber button to open wind speed, source direction, gust, forecast time, and
coordinates. The Wind/Waves switch shows ECMWF's combined wind waves and swell
height as map color, with mean wave period in the flag and details panel. These
are not primary swell partition values. The timeline steps through the first
72 forecast hours. Displayed times use the browser's local timezone.

Click a point, open its details, and choose **Explore historical swell and wind**
to compare up to five complete years. Set a swell-height range, minimum swell
period, maximum wind speed, clockwise wind-from and swell-from bearing ranges, and
minimum consecutive hours. Aer ranks months by the share of usable days with
a matching window between 06:00 and 18:00 in the spot's local timezone, shows
qualifying dates, and exports the paired hourly data
as CSV. A circular map in the history panel centers the selected spot; drag the
teal wind dots or amber swell dots around it to set each clockwise bearing
range, or enter degrees directly. The preview starts at zoom level 11; its slider
reaches level 20 and changes only the map scale. Raster maps use level-19 tiles
at the closest zoom. Historical days use the selected spot's local
timezone. Eligible hourly samples run from 06:00 through 17:00; 18:00 is
excluded. This fixed surf window does not track seasonal sunrise and sunset.
The CSV retains all hours, with nighttime rows marked as not meeting conditions.

Name and save a point from **Find your season** to keep its location, years,
and conditions. **Saved spots** on the map lists them; their markers reopen
the same settings. You can update a spot, save a copy, or remove one. These
saves stay in this browser's local storage.

Each saved spot can also check its conditions against the next 14 local
calendar days. Choose the minimum number of matching days for an on-screen
alert. A matching day needs at least two consecutive hours (or the larger
minimum window set in the conditions). The alert appears in the top-right
corner, shows the matching-day count and next matching window, and opens the
spot when clicked. Alerts refresh while the app is open; they are not push
notifications.

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
npm run smoke:history
npm run smoke:zoom
npm run smoke:saved
BROWSER=firefox npm run smoke:live
BROWSER=webkit npm run smoke:live
```

`npm run build` copies the approved ecCodes WASM decoder, bundles its worker,
and compresses the WASM file for the production server. `node scripts/serve.ts`
serves `dist` on `$PORT` (default 3000); `GET /health` responds with `ok`.
The Dockerfile builds and runs the same static server on Railway.

The browser fetches ECMWF's `.index` and GRIB2 byte ranges directly from its
Google Cloud Open Data mirror. Wind uses the `oper` stream; waves use `wave`.
No ECMWF key or weather proxy is needed.
Historical swell uses Météo-France MFWAM through Open-Meteo Marine; historical
10 m wind uses ECMWF IFS through Open-Meteo Archive. Both are requested directly
by the browser for sea grid cells near the selected point. Source links and
the returned model-cell coordinates appear in the history panel.
The 14-day alert uses GFS Wave swell and ECMWF IFS wind forecasts through
Open-Meteo. These are requested directly by the browser and differ from the
historical MFWAM swell source and the live ECMWF GRIB map layer.
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
- Wind downloads three compressed global fields per step; waves download two.
  First use downloads a 39.6 MB WASM decoder (about 6.8 MB over the network
  with gzip).
  In one Chromium step-3 check, its WASM heap was 64 MiB and the three decoded
  arrays totaled 12.5 MB, before map and browser overhead. Decoding and
  animation can be demanding on older phones.
- Gusts are shown as unavailable if the gust field cannot be fetched or decoded.
- Monthly history covers complete years from 2022 onward. A day needs at least
  18 paired hourly values to count in the denominator. MFWAM's source cadence
  is three hours; Open-Meteo provides interpolated hourly values between model
  outputs. These are model estimates useful for seasonal screening, not
  observed conditions at a break. Open-Meteo's free API is for noncommercial
  use; a commercial deployment needs a suitable API plan or self-hosted source.
- Browser checks cover Chromium, Firefox, and WebKit desktop/mobile on Linux.
  Physical iOS Safari, older phones, and actual zoom frame rates on hardware
  have not been measured.
- Forecast alerts check when the page opens and about every six hours while it
  remains open. Available future model output becomes coarser farther ahead;
  Open-Meteo interpolates it to hourly samples. Conditions are estimates at
  the chosen sea grid cell, not surf reports at the exact shore point.

See [ARCHITECTURE.md](ARCHITECTURE.md) for data and state boundaries.

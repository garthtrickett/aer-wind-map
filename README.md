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
to compare up to five complete years. Set a swell-height range, minimum and optional
maximum swell period, maximum wind speed, clockwise wind-from and swell-from bearing ranges, and
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

Checking the alert checkbox in **Find your season** immediately previews the
forecast before saving. **Search the next … days** controls the look-ahead,
defaulting to 14 days (the supported maximum). Editing conditions, rules or
look-ahead rescores the downloaded hours; **Refresh forecast** fetches new data.

Add one or more rules such as **2 matching days in any 4-day period**, or
**4 in any 7-day period**. Aer slides each period across the look-ahead and
triggers if **any** row qualifies. A complete period must fit inside the chosen
horizon; later matching days can qualify even when the first few days do not.
Results show the best period, its dates, all qualifying periods, and any gaps
in data coverage. A matching day needs at least two consecutive hours (or the
larger minimum window set in the conditions). The look-ahead starts today in
the spot's local timezone. Existing saved spots default to 14 days.

The on-screen alert appears in the top-right corner, shows the matching-day
count and next window belonging to a qualifying period, and opens the
spot when clicked. **Saved spots → Telegram alerts** can also connect a private
Telegram chat. Enabled spots sync to durable server storage and are checked about
every six hours with the app closed. Messages list qualifying dates/windows,
identify the source models and state partial data coverage. Matches use
06:00–18:00 at the spot; unchanged matches are suppressed and qualifying dates
are confirmed as they approach. A notification link opens a read-only preview
in a fresh phone browser. Disconnect in Aer or send `/stop` to the bot to stop.

## Map and satellite backgrounds

With a MapTiler key configured, a **Map / Satellite** switch appears beside the
zoom controls. Map uses the existing OpenFreeMap street style (OpenStreetMap
raster on browsers without WebGL2). Satellite uses MapTiler's regular imagery
basemap; it does not select historical capture dates. Changing backgrounds keeps
the current location, zoom, saved markers, forecast and settings.

Satellite starts with weather shading and arrows hidden for a clear view.
Enable **Weather overlay** to show the current wind/wave field over the imagery.
Returning to Map restores the weather overlay. MapTiler's logo and imagery
credits appear in Satellite view. If imagery cannot load, Aer returns to Map.

To enable it, create a MapTiler key restricted to the app's domain, set
`VITE_MAPTILER_API_KEY` in Railway build variables, and redeploy. For local
development set it in `.env.local`. The key is browser-visible by design;
never use this variable for a bot token or other server credential. Without a
key the satellite control stays hidden and Aer requests no MapTiler data.
Choose a suitable [MapTiler plan](https://www.maptiler.com/cloud/pricing/);
the Free plan is for testing, personal or noncommercial use and has usage caps.

For the simulated-provider browser check, build with
`VITE_MAPTILER_API_KEY=test-only npm run build`, then run `npm run smoke:basemap`.
This tests controls and rendering without contacting MapTiler; it does not
verify a real account's imagery access. Rebuild with the intended key before use.

## Look up a particular day

Open point details or a saved marker and expand **Look up a day**. Choose a date
from 2022 onward and press **Load day**. The hourly table defaults to
06:00–18:00, with the end hour excluded; choose 00:00–24:00 for the whole day.
Changing the hour range filters the loaded data without downloading it again.

Wind shows km/h, compass direction and degrees from ECMWF IFS. Swell and
combined waves each show height, period and direction from Météo-France MFWAM.
Combined waves include wind waves and swell; these heights are not surf-face
heights. MFWAM's native three-hour values are interpolated to hourly by Open-Meteo.
These are historical model estimates, not station measurements. Times are local
to the displayed timezone, and the actual wind and wave grid coordinates are
shown separately. Recent days may not yet be published. Missing values stay
missing, and one source can still display when the other is unavailable.

## Measured wave and wind stations

Open **Observations**, select **Wave buoys** or **Wind stations**, and zoom into
an area (zoom 5 or closer). Click a marker for measured height, reported wave
period and direction, or wind speed, direction and gust where supplied. Times
use the browser's timezone. Reports older than three hours are grey and labelled
as older reports. Moving the forecast slider does not change station readings.
Japan NOWPHAS wave gauges and offshore GPS buoys are also included. Grey ↶
markers identify archive stations without a current report.

With **Wind stations** enabled, **Taiwan coastal wind only** is on by default.
It keeps Taiwan land stations and airports within approximately 5 km of the
ocean shoreline. Uncheck it to restore inland Taiwan stations. Offshore buoy
winds and stations in other countries remain available. Distance uses bundled
Natural Earth 1:10m coastline data (public domain), including offshore islands;
it does not treat lake shores or county boundaries as the coast. The cutoff is
approximate and describes location, not how sheltered or exposed a sensor is.

For Japan NOWPHAS and Taiwan CWA archive stations, choose **Wave history** in
the station popup, select a date, and press **Load date**. A wave-height chart,
measurement table and CSV export show the measured record. Historical times
use the station's local timezone (Japan UTC+9, Taiwan UTC+8), explicitly
labelled above the table. All hours of the day are included, independently
of the 06–18 model-based seasonal score.

NOWPHAS supplies significant wave height and significant wave period at
20-minute intervals, with a two-hour fallback for older records. CWA's archive
supplies significant height, **peak period** and **mean period** hourly.
These period definitions are kept separate; neither archive is labelled as
primary swell. Gaps stay missing. NOWPHAS marks confirmed versus provisional
records, and its downloadable archive can lag several months behind today.
The app reads its current publication limit rather than inventing newer data.
Coverage varies by station and year; the CWA history integration uses stations
listed in CWA's own accessible archive, not every buoy shown by other agencies.

Sources are NDBC's reporting marine/coastal stations, Taiwan CWA's buoys and
wave stations (including Chenggong), CWA land wind stations, and worldwide
airport METAR reports (including Ngurah Rai). Availability varies by location;
this does not provide a complete global buoy network or BMKG harbour AWS data.
CWA land directions are compass sectors; METAR variable and calm winds retain
their meaning. Wave heights describe significant sea-state height, not surf
face height or a primary-swell partition.

The existing Node server and Vite dev server expose `/api/observations` because
the providers do not allow direct browser requests. It accepts bounded map
coordinates and layer flags only, uses fixed public upstream URLs, caches
reports for 5–10 minutes, and shares in-flight requests. No API key, database or
new dependency is required. `/api/buoy-history` validates station/date inputs
against provider station catalogues, uses fixed archive URLs and keeps up to
eight station/year or station/month datasets in memory for six hours. Only
three concurrent archive requests are allowed. ZIP entries are read in memory
with compressed and expanded size limits; no provider paths are written to
disk. Station readings refresh every five minutes while
the page is visible. A failed feed is labelled while other providers continue.

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
npm run smoke:forecast
npm run smoke:linked
BROWSER=firefox npm run smoke:live
BROWSER=webkit npm run smoke:live
```

`npm run build` copies the approved ecCodes WASM decoder, bundles its worker,
and compresses the WASM file for the production server. `node scripts/serve.ts`
serves `dist` on `$PORT` (default 3000); `GET /health` responds with `ok`.
The Dockerfile builds and runs the same server on Railway.

Telegram additionally needs a dedicated bot, a persistent volume and an always-on
Node 24 process. See [setup and recovery](docs/telegram-alerts-operations.md) and
the [reviewed implementation plan](docs/telegram-alerts-plan.md). Configuration
names are in [.env.example](.env.example); credentials are server-only.

The browser fetches ECMWF's `.index` and GRIB2 byte ranges directly from its
Google Cloud Open Data mirror. Wind uses the `oper` stream; waves use `wave`.
No ECMWF key or weather proxy is needed.
Historical swell uses Météo-France MFWAM through Open-Meteo Marine; historical
10 m wind uses ECMWF IFS through Open-Meteo Archive. Both are requested directly
by the browser for sea grid cells near the selected point. Source links and
the returned model-cell coordinates appear in the history panel.
Forecast previews and browser/Telegram alerts use Météo-France MFWAM primary
swell and ECMWF IFS wind through Open-Meteo. MFWAM supplies up to 10 forecast
days at a native three-hour cadence, interpolated to hourly values by Open-Meteo;
wind remains hourly. Saved look-ahead settings still support 1–14 days. Dates
beyond the available swell forecast remain unknown, with paired coverage shown
in results and notifications. No GFS fallback or extrapolated swell is used.
This uses the same swell model as historical scoring, and differs from the
live ECMWF combined-wave GRIB map layer.
MapLibre renders OpenFreeMap Positron vector tiles where WebGL2 is available;
Leaflet uses standard OpenStreetMap raster tiles as a fallback. Source credits
stay visible on the map.
Wind color uses a reduced-size texture in a MapLibre WebGL layer. Animated
arrows use a second WebGL canvas that follows the map's zoom transform. Browsers
without WebGL2 use reduced-resolution Canvas 2D color and arrows.

## Linking an offshore swell point with nearshore wind

1. Save the offshore point with **Marker type → Swell only**.
2. Save the coastal point with **Marker type → Wind only**. Set its X-out-of-Y rules; its own
   alert checkbox can stay off.
3. Reopen the offshore point, select the coastal point under **Link conditions
   from other saved spots**, enable forecast checking and update the saved spot.

A matching day requires overlapping UTC hours when every linked point's selected
conditions pass, within 06:00–18:00 at each point. The longest minimum hourly
window and shortest look-ahead in the group apply. Every point must pass at
least one of its own sliding day-count rows using those jointly matching days.
The preview shows each linked point's result; dashed lines join linked map pins.
Missing points or missing required forecasts cannot trigger an alert. Remove a
broken requirement explicitly or restore the missing point.

Links apply to forecast previews and browser/Telegram alerts. Historical charts
and CSVs score only the selected point and its chosen sources. Telegram stores
required linked points even if their individual alerts are disabled. A shared
phone link includes read-only linked settings without importing them into the
recipient's saved spots.

### Calm wind and marker types

Saved map markers display **W** (wind), **S** (swell), or **W+S** (both).
Change **Marker type** in the spot editor to select what the point checks;
the saved-spots list and marker tooltip show the same type.

**Wind direction ignored at or below** defaults to **2 km/h**, including older
presets without this field. Adjust it from 0–10 km/h; 0 disables the exception.
Only the wind direction check is bypassed. The maximum wind speed, all selected
swell conditions, consecutive hours and linked day-count rules still apply.
Known calm wind speed can pass when direction is missing; unknown wind speed
cannot. This rule applies to history, CSVs, forecast previews and Telegram alerts.
It is a filtering preference, not a guarantee of a glassy sea surface.

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

Telegram acceptance does not establish phone delivery. Uncertain sends are held
for reconciliation rather than blindly retried. Forwarded spot-view links grant
read-only access to that spot/conditions for seven days, never account control.
Saved presets remain local; monitor snapshots persist on the server.

See [ARCHITECTURE.md](ARCHITECTURE.md) for data and state boundaries.
For imagery sources and Google Earth's historical imagery button, see the
[satellite imagery research note](docs/satellite-imagery.md).

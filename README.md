# Aer — global wind and primary swell forecast

Aer shows ECMWF IFS 10 m wind on a global OpenStreetMap-derived map. Color covers
the visible world, and arrows move toward the wind's destination. The main map
zooms to level 20 for close inspection of streets and coastlines. A distance
scale at the bottom right updates as you zoom or pan, showing kilometres or
metres at the map's centre latitude. Use **Measure** near the zoom buttons to
draw a temporary line. Tap or click
to add points; the panel shows the total ground distance in metres or kilometres.
**Done** leaves the line visible while you pan or zoom, **Edit line** adds more
points, and **Undo**, **Clear** or **Close** adjust or remove it. Zoom changes the
line's screen size but not the distance between its geographic points. While
measuring, map taps add points instead of moving the forecast flag. Click the map
to place a wind flag showing speed in km/h, drag the flag to inspect another
point, and click its card or amber button to open wind speed, source direction,
gust, forecast time, and coordinates. The **Wind / Swell** switch shows MFWAM
primary swell height as map colour, with primary period and source direction in
the flag and details. Crest animation follows that primary swell's travel direction.
The map reads only the three primary-swell fields from Open-Meteo's public
MFWAM spatial OM files using a separate WASM worker. It samples every second
native cell (0.083°) to a 0.167° global display grid, preserving missing data.
Native propagation bearings are converted to FROM bearings. Map and flag use
the same run and fields; there is no combined-wave fallback or duplicate point reading.
The timeline covers +3 through +72 forecast hours and initially selects the
first three-hour step at or after the current time for MFWAM. Displayed times
use the browser's local timezone. Changing the slider cancels obsolete swell loads.


Dates throughout the app and Telegram alerts use **DD/MM/YYYY**, with 24-hour
times. The day and wave-history controls accept that format directly and retain
a calendar button, regardless of the browser's language or regional settings.
Archive publication months use MM/YYYY. APIs, saved data and CSV timestamps use ISO.

## Find a place

Use **Find a place or coordinates** on the main map, point details or **Find your season**.
Enter a town, beach or landmark (add the region/country for ambiguous names),
press **Search** or Enter, then choose a result to move the forecast marker and
center the map. You can drag the flag afterward to refine the location.
Search results are approximate map locations, not verified surf peaks.

Searching from a saved marker keeps its name, conditions, years and linked spots
in the editor. The stored marker and Telegram monitor move only after
**Update saved spot**. Previously loaded weather/history is cleared on relocation.

Paste decimal coordinates in **latitude, longitude** order, for example
`11.350744113186904, 119.46119075878524`, and press Enter or Search to move the
marker immediately. Coordinates retain their full precision, are validated
locally and work without an API key. Invalid pairs leave the marker unchanged.

Place-name search uses the existing `VITE_MAPTILER_API_KEY`; no additional key is
needed. It requests MapTiler geocoding only on submission, not on every keystroke,
and counts toward the account's API usage. Without a key, coordinate entry
remains available.
Provider failures and empty results leave the marker where it is.

Click a point, open its details, and choose **Explore historical swell and wind**
to compare up to five complete years. Set a swell-height range, minimum and optional
maximum swell period, maximum wind speed, clockwise wind-from and swell-from bearing ranges, and
minimum consecutive hours. Aer ranks months by the share of usable days with
a matching window between 06:00 and 18:00 in the spot's local timezone, shows
qualifying dates, and exports the paired hourly data
as CSV. A circular map in the history panel centers the selected spot; drag the
teal wind dots or amber swell dots around it to set each clockwise bearing
range, or enter degrees directly. The preview starts at zoom level 11 for new
spots. **Update saved spot** and **Save as new** store the current circular-map
zoom with that spot and restore it when reopened, including after a page reload.
Unsaved zoom changes leave the stored view unchanged.

You can also set an optional **Beach / reef angle**. Click **Set beach / reef
angle**, drag the purple dots parallel to the
local beach or reef, and use **Flip sea side** to point SEA toward the water.
The angle can also be entered numerically (0° is north–south; 90° is east–west).
The table shows each wind/swell boundary relative to the perpendicular: wind 0°
means directly offshore and swell 0° means arriving straight in. Positive is
clockwise, negative anticlockwise; the width retains the selected clockwise arc,
including a full 360°. The alignment is stored with **Update saved spot** or
**Save as new**. It is a reference for choosing bearings; forecasts and alerts
continue to use the selected compass bearings.

The zoom slider reaches level 20 and changes only the map scale. With the configured MapTiler
key, the circular preview defaults to satellite imagery, with provider credits
below the circle. It uses the same imagery source as the main map and keeps
direction handles and forecast rays above the image. If imagery is unavailable,
it shows the street map instead. Imagery metadata is reused when reopening or
moving the marker. Tiles respect the provider's native detail limit; street tiles
are capped at level 19. Historical days use the selected spot's local
timezone. Eligible hourly samples run from 06:00 through 17:00; 18:00 is
excluded. This fixed surf window does not track seasonal sunrise and sunset.
The CSV retains all hours, with nighttime rows marked as not meeting conditions.

Click a month to expand hourly condition distributions for those same local
06:00–18:00 hours across the selected years:

- **Wind direction × speed** (wind-only and combined markers) groups winds
  into eight compass sectors and 2–5, 5–10, 10–15, 15–20 and ≥20 km/h bands.
  Each cell is a percentage of all usable wind hours, including calm hours in
  the denominator. Calm below 2 km/h is shown separately, even when direction
  is missing. This fixed display threshold is independent of the marker's
  adjustable calm allowance. Missing non-calm directions and speeds are excluded.
  All winds are included regardless of matching rules; the top three direction
  and speed combinations and sample coverage appear below the table.
  An **All speeds** column totals each direction across all speed bands, using
  raw counts before rounding. These direction totals plus the separate calm
  percentage account for all usable wind hours.
- **Swell height × period** (swell-only and combined markers) includes separate
  <6 s and 6–8 s columns, then 8–10, 10–12, 12–14, 14–18 and ≥18 s. All swell
  heights, periods and directions are included regardless of swell rules. For
  combined markers, cells count hours with acceptable wind against all usable
  paired swell/wind hours, so the table can total less than 100%.
  An **All heights** footer totals each period column across all swell sizes,
  using raw sample counts before rounding and retaining the same denominator
  and, for combined markers, the same good-wind requirement.

Both distributions show hourly frequencies, not percentages of qualifying days.
Speed and period bands include their lower bound and exclude their upper bound.

Name and save a point from **Find your season** to keep its location, years,
and conditions. **Saved spots** on the map lists them; their markers reopen
the same settings. You can update a spot, save a copy, or remove one. These
saves stay in this browser's local storage until you sign in and import them.

## Email accounts and browser import

Choose **Sign in** on the map (or the account button in **Saved spots**). Enter
your email to sign up or sign in using the same flow. Open the emailed link,
check the email address shown, then choose **Continue to Aer**. Links expire
after 15 minutes and work once; opening a link alone does not consume it.
Account sessions last up to 30 days. Login secrets stay out of URL query strings
and server access logs and are removed from the address bar after opening.

On the browser that contains your existing spots, sign in and choose
**Account → Import this browser’s … spots**. This is a one-time, transactional
import per browser and account. It includes all saved wind/swell markers,
criteria, year ranges, alert rules, linked markers, beach alignment and mini-map
zoom. Existing server spots are retained; colliding IDs are remapped together
with their links. Repeating a request after a timeout does not import twice.
The original `aer.saved-spots.v1` browser copy is kept unchanged. Other browsers
cannot access that old browser copy; run the import where the data exists.

While signed in, adding, updating and deleting spots saves to your account.
A new device loads the same collection after sign-in. **Refresh saved spots**
loads changes made on another device. Unsynced edits are stored separately on
the current device and retried on reload. Independent edits from other devices
merge; conflicting edits require a visible choice before replacing a version.
Signing out restores this browser's original local collection. It does not
delete your account spots or disconnect its server-side Telegram monitoring.
Existing Telegram connections are attached to the verified account on first
sign-in from their original browser, and then follow that account across devices.

### Server setup

Use Node 24 and a durable volume. Set `AER_ACCOUNT_DB=/data/aer-accounts.sqlite`
and the HTTPS `PUBLIC_APP_URL` origin. On Railway, the account database defaults
to `aer-accounts.sqlite` under `RAILWAY_VOLUME_MOUNT_PATH` if no explicit path
is configured. This is separate from the existing Telegram database.

Set server-only `RESEND_API_KEY` and `AER_EMAIL_FROM` using an address on a
verified sending domain. No email provider credentials belong in `VITE_`
variables. If email delivery is not configured, Aer clearly labels sign-in as
unavailable and keeps browser-only use working. Production never exposes login
links in API responses, logs or a development mailbox. Local development reads
these settings from `.env.local`; its `PUBLIC_APP_URL` must match the Vite origin.

Accounts, hashed login/session secrets, import receipts and send rate limits
are stored in SQLite. Every account read/write is scoped to the session's user;
writes also identify the expected user to reject stale tabs after account
switching. Mutations check the exact app origin. Email requests have persistent
per-address, connection-IP and global rate limits. Back up the account database
using SQLite-aware tooling or volume snapshots; do not copy a live database
without its pending WAL data.

Run `npm run test:accounts`, `npm run build`, then `npm run smoke:accounts`.
The browser smoke uses a local fake email transport with the real account API;
it sends no email and checks mobile import, cross-device editing, logout and
account isolation. A real received email still needs verification after the
provider credentials and sender domain are configured.

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

Each matching day also shows the forecast conditions during its displayed
matching window: wind speed in km/h and source directions, plus primary swell
height, period and source directions. Values that vary show minimum–maximum
ranges for those hours, not whole-day averages. Expand **Hourly forecast** for
each hourly value and direction in degrees; the window's end time is excluded.
Linked markers have separate named readings and tables, so an offshore swell
point is not confused with the nearshore wind point. This reuses the downloaded
forecast without additional API requests. These are model forecasts, not station
measurements or breaking-wave heights.

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

## Historical imagery

The optional **Imagery history** button uses Esri World Imagery Wayback.
Zoom into a coast (level 10 or closer), select a pin or use the map center,
and choose a reported capture date. **View selected spot** zooms to detail
when starting from a wide view. Older/Newer buttons switch available captures.
Panning without a pin searches the new center; with a pin, dates stay tied to
that point. Changing detail level searches again.

The panel shows acquisition date, source/provider, source pixel resolution and
archive release date separately under **Source & capture details**. Duplicate
captures are collapsed, while
unknown acquisition dates remain explicitly unknown. A release is a basemap
mosaic: nearby tiles can come from other dates. Source resolution does not
promise the same detail in every displayed tile. The forecast timeline and
the daily weather lookup are independent of imagery dates.

Before public activation, confirm an appropriate Esri licence/subscription
under the [World Imagery usage terms](https://goto.arcgis.com/termsofuse/viewsummary).
Set `VITE_ESRI_WAYBACK_ENABLED=true` in the build environment and rebuild.
Without it the button is hidden and no Wayback data is requested. The flag
is feature configuration, not an authentication credential. Current Wayback
services are publicly accessible; that alone does not grant display rights.
The app requests tiles directly for viewing; it does not proxy, persist,
export or offer downloads of Esri imagery.

For a private UI regression build:

```sh
VITE_ESRI_WAYBACK_ENABLED=true VITE_MAPTILER_API_KEY=test-only npm run build
npm run smoke:wayback
npm run smoke:basemap
```

The SDK's Apache licence ships at `/third-party/wayback-core-LICENSE.txt`.

The smoke tests exercise the official SDK against simulated services on desktop,
390 px and 320 px mobile, with WebGL and the fallback renderer. Rebuild with
the intended production variables afterward. See [imagery research and deployment
status](docs/satellite-imagery.md) for real-provider verification.

## Compare forecast directions with your ranges

Open a marker's **Find your season** panel. Its compass shows your selected
wind and swell ranges as solid pie edges, with dashed lines pointing toward
the directions the forecast wind and primary swell come **from**. Drag the
range dots or edit the bearings to compare immediately; forecasts never change
your saved criteria.

**Now** shows the current hourly forecast. **Map forecast time** follows the
main map's timeline. The card shows the local valid time, ECMWF wind in km/h,
and MFWAM primary swell height and period. These are model forecasts, not live
station measurements; MFWAM's three-hour values are interpolated to hourly.
Inside/outside labels compare direction only, with your calm-wind override
shown separately. Wind-only and swell-only markers request their chosen source.
Missing directions produce no dashed line, and either source can remain usable
if the other fails. Data loads without enabling alerts, refreshes after 15 minutes
while the panel is open, and can be refreshed manually.

## Look up a particular day

Open point details or a saved marker and expand **Look up a day**. Choose a date
from 2022 onward and press **Load day**. The hourly table defaults to
06:00–18:00, with the end hour excluded; choose 00:00–24:00 for the whole day.
Changing the hour range filters the loaded data without downloading it again.

Wind shows km/h, compass direction and degrees from ECMWF IFS. Primary swell
shows height, period and direction from Météo-France MFWAM. These are offshore
swell estimates rather than surf-face heights. MFWAM's native three-hour values are interpolated to hourly by Open-Meteo.
These are historical model estimates, not station measurements. Times are local
to the displayed timezone, and the actual wind, wave and tide grid coordinates are
shown separately. Recent days may not yet be published. Missing values stay
missing, and each source can still display when another is unavailable.

Tide / sea level comes from Météo-France SMOC via Open-Meteo Marine, using a
separate request pinned to `meteofrance_currents` and `sea_level_height_msl`.
The selected hours show a curve and hourly heights in metres, including valid
negative values. Rising/falling labels use adjacent hourly samples, without
bridging missing readings. These are sea levels including tides and weather
effects relative to global mean sea level, not local chart datum or a pure
astronomical tide prediction. The approximately 8 km grid has limited coastal
accuracy. Historical tide coverage varies; unavailable dates show missing
values and a source message while retaining wind and primary swell.

## Measured wind stations

Open **Observations**, enable **Wind stations**, and zoom to level 5 or closer.
Markers show measured wind in km/h; station details show wind direction and gusts
where supplied. Reports older than three hours are grey. The Taiwan coastal
wind filter remains available. Buoy total-wave readings and their history views
are hidden because they do not isolate primary swell. Their source integrations
and stored data are retained; they are never relabelled as primary swell.

Sources are NDBC, Taiwan CWA and airport METAR reports. Station readings are
independent of the model forecast slider and may differ from nearby beaches.

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
npm run smoke:places
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
Google Cloud Open Data mirror for wind using the `oper` stream. Primary swell
uses `data_spatial/meteofrance_wave` in the public Open-Meteo S3 bucket instead.
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
This uses the same swell model as the primary-swell map. Point series use the
provider's native sea-cell selection and hourly interpolation; the map uses its
labelled display grid and a fixed three-hourly run.
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
- Wind downloads up to three compressed global GRIB fields per step; primary swell
  reads three partition fields from spatial OM files using HTTP byte ranges.
  First use downloads a 39.6 MB WASM decoder (about 6.8 MB over the network
  with gzip).
  In one Chromium step-3 check, its WASM heap was 64 MiB and the three decoded
  arrays totaled 12.5 MB, before map and browser overhead. Decoding and
  animation can be demanding on older phones.
- Gusts are shown as unavailable if the gust field cannot be fetched or decoded.
- Monthly history defaults to all available complete years from 2022 onward,
  up to the supported five-year limit. A day needs at least
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

### Direct ECMWF hourly swell history

The historical panel offers **ECMWF ECWAM · hourly hindcast** alongside the existing
MFWAM source. Existing saved spots keep MFWAM. The source selection is saved with the spot and syncs through accounts. Forecast alerts and
the separate day lookup retain their existing data sources.

This uses the public CY50R1 research experiments
[ijxo (2019–2023)](https://apps.ecmwf.int/ifs-experiments/rd/ijxo/) and
[iocj (2024–2025)](https://apps.ecmwf.int/ifs-experiments/rd/iocj/), CC BY 4.0.
These are hourly ECWAM hindcasts with corrected ERA5 atmospheric forcing and
altimeter assimilation, **not archived operational forecasts or the old ERA5
wave reanalysis**. The app currently offers complete years from 2022 to 2025.
Output is sampled on a 0.125° grid from the approximately 14 km model. Nearshore
bathymetry remains unresolved; put swell markers offshore.

Both partitions are retrieved together: 140121/122/123 (first swell height,
direction, period), 140124/125/126 (second swell height, direction, period).
ECWAM period is Tm−1,0; existing MFWAM historical period is Tm01. The same numeric
period threshold is not an equivalent filter between models. The app displays
primary swell only; older secondary selections open as primary. CSV exports name
the source, primary component and period definition. Both partitions remain in
the server cache.
A zero-height component counts as available data but cannot qualify as swell.

Set server-only `ECMWF_API_EMAIL` and `ECMWF_API_KEY` from the registered
[ECMWF Web API](https://api.ecmwf.int/v1/key/) account. This is a different key
from Copernicus CDS. Configure an absolute `AER_WAVE_HISTORY_DB`, or use the
Railway volume default `/data/aer-wave-history.sqlite`. Nothing is placed in
`VITE_*` variables. The runtime needs Node 24 and production `netcdfjs`.

Opening a marker reads the cache without starting archive requests. **Prepare
missing ECMWF history** requires an authenticated account and same-origin POST.
The server deduplicates monthly grid-cell requests, limits the queue to 128
months and new requests to 64 months per account per 24 hours, and runs one
provider job at a time. First downloads can take 20–30 minutes **per month**;
a multi-year range can take many hours. Both components share one download.
Monthly results appear incrementally; percentages count downloaded usable days,
not missing months. Until the range is complete, the displayed best month may
reflect uneven coverage. The app requests adjoining UTC months where published,
so local calendar dates join correctly; 2026 is not available as an end boundary.

SQLite stores the upstream receipt before polling. A four-minute renewable
worker lease excludes overlapping replicas during deployments. Browser polling
stops when the view closes; server work continues. Restarted workers resume known
receipts. An interrupted or uncertain submission without a receipt is marked
failed and **never automatically resubmitted**. Inspect the account's ECMWF
requests before resolving such a failure, to avoid a duplicate submission.
Provider results are deleted only after validated data is committed to the cache.

`npm run test:wave-history` checks real packed NetCDF values, UTC joins, absent
components, persistence, queue deduplication, worker exclusion, uncertain sends,
and HTTP authentication/origin restrictions. `node tests/wave-history-smoke.ts`
checks source controls, primary swell, saved settings, CSV and desktop/mobile layouts
against a real extracted month fixture with mocked transport. The fixture's
0.25° validation cell is explicitly separate from the production 0.125° cache.

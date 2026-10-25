# Satellite imagery sources and historical views

Research reference, checked 25 October 2026. A dated satellite layer has been
investigated but is not implemented in Aer.

## Sources

| Source | What it offers | Use for surf scouting |
| --- | --- | --- |
| Copernicus Sentinel-2 | Free optical imagery; visible bands have 10 m pixels; nominal five-day revisit | Coastline orientation, headlands, river mouths and broad reef/channel layouts. Too coarse for reliable inspection of individual waves or small sandbanks. |
| Vantor (formerly Maxar), including WorldView | Paid detailed commercial imagery, available through marketplaces such as SkyFi | Finer coastal features, subject to the particular capture's resolution, clouds, tide and water clarity. |
| Planet, including SkySat | Paid detailed commercial imagery, also available through SkyFi | Another source to search for detailed captures on useful dates. |
| Google Earth | Satellite and aerial imagery from multiple providers, with historical views | Inspect the available detailed coastal images and compare dates manually. |
| Esri World Imagery Wayback | Historical releases of Esri's satellite/aerial basemap, with tiles and capture metadata | A technically viable source for a detailed history layer, subject to Esri's usage terms and account requirements. |

SkyFi is a marketplace: its free Sentinel-2 imagery comes from Copernicus;
its paid detailed imagery comes from commercial providers. We can access
Sentinel-2 without going through SkyFi. Higher-resolution imagery does not
guarantee that submerged seabed features or surf quality will be discernible.

Sources:

- [Copernicus Sentinel-2 specifications and free access](https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2)
- [SkyFi's guide to Copernicus Sentinel-2 imagery](https://learn.skyfi.com/how-to/how-to-order-sentinel-2-open-data/)
- [SkyFi products, including WorldView and SkySat](https://skyfi.com/en/products)
- [Google's explanation of its imagery sources](https://blog.google/products-and-platforms/products/maps/how-do-satellite-images-work/)

## Google Earth's history button

Google Earth has a **Historical imagery** button that opens a timeline of
available imagery. On the web, search for the location and choose
**Historical imagery** in the toolbar. In Google Earth Pro, use
**View → Historical Imagery** or the clock button.

Available dates and image quality vary by location. Images can be mosaics from
different dates. This is a feature of Google Earth; it does not establish that
the same dated imagery can be embedded in Aer through a public Google Maps API.

- [Open Google Earth](https://earth.google.com/web/)
- [Google Earth: view a map over time](https://support.google.com/earth/answer/148094?hl=en)
- [Google Earth: image collection dates and mosaics](https://support.google.com/earth/answer/6327779/how-images-are-collected?hl=en)

## Esri Wayback investigation

Checked 25 October 2026, after implementing Aer's particular-day wind/wave lookup.
The public catalogue returned 197 basemap releases, from 2014-02-20 through
2026-09-24. These are publication dates, not 197 distinct photographs of each
location. Earlier photographs can appear in later published basemaps.

Esri publishes an official [`@esri/wayback-core` library](https://github.com/Esri/wayback-core)
for release discovery, local changes and capture metadata. Its raster tiles
fit Aer's Leaflet map. A real Chromium check from Aer's origin successfully
fetched the catalogue, a tile, local-change data and capture metadata without
an API key. The library was not installed in Aer and no imagery layer was deployed.

### Sample coastal coverage

These are point/zoom-specific results from the live service, not a complete
inventory of either region. Dates below are the metadata's reported capture
dates, not publication dates or exact acquisition times.

| Sample point | Zoom | Distinct reported capture dates | Reported source resolution |
| --- | --- | --- | --- |
| Jinzun coastline, 22.953 N, 121.289 E | 17 | 2009-06-16, 2012-03-15, 2017-07-15, 2019-07-10, 2020-06-04, 2021-07-25 | 0.31–1.2 m |
| Sanur reef/lagoon area, 8.700 S, 115.267 E | 18 | 2017-09-09, 2018-04-06, 2019-10-20, 2020-05-26, 2022-03-24, 2023-03-18, 2024-09-27, 2025-05-01 | 0.3–0.5 m |

Sources included Vantor/Maxar/DigitalGlobe WorldView and GeoEye imagery. Source
resolution in metadata is distinct from the map tile's delivered pixel scale.
The sample tiles show much finer coastal detail than the free 10 m Sentinel-2
images, but tide, water clarity and surface conditions still affect interpretation.

### Requirements for a future layer

- Discover local changes and deduplicate repeated captures; even byte-different
  tiles can share the same capture date. Changing the publication year alone
  must not be presented as a new photograph.
- Show **capture date at the marker**, provider and source resolution, with
  publication date separately. A viewport can contain imagery from several dates.
- Coverage depends on zoom. The initial offshore Jinzun test at zoom 18 exposed
  only the 2021 capture; a nearby coastline point at zoom 17 exposed older imagery.
  Handle missing detailed tiles explicitly or offer a labelled coarser view.
- Keep imagery date separate from the weather forecast. A capture date could
  prefill the daily weather lookup, but metadata did not supply the exact hour.
- Keep provider failures visible; one metadata request timed out during testing.
- Confirm the appropriate Esri account/usage licence and attribution before
  public integration. Anonymous technical access does not establish unrestricted
  free production use. Esri's linked terms summary ties use to its software or
  subscriptions and restricts tile harvesting, redistribution and self-hosting.

References: [Esri's integration guidance](https://github.com/Esri/wayback),
[publication versus capture dates](https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/imagery/wayback-with-world-imagery-metadata),
[Esri-owned content terms summary](https://goto.arcgis.com/termsofuse/viewsummary).

## Cost and integration notes for Aer

- SkyFi's **existing image** pricing buys a selected area from one archived
  capture. Additional capture dates are separate purchases, not an unlimited
  historical subscription. Check the actual listing for coverage and price.
- The supplied 2026 pricing sheet lists 16–30 cm archive imagery at $24/km²
  with a 1 km² minimum: $24 for one minimum-area capture, or $72 for three
  dates if suitable images exist at that rate. Prices are USD and indicative.
- Commissioning a **new image** is a separate service for a future capture,
  with larger minimum areas and higher costs.
- Public map display needs the applicable imagery licence checked. SkyFi's
  published EULA limits internet posting to promotional extracts; do not assume
  a purchase authorises a public interactive imagery layer.
- Sentinel-2 catalogue searches, dated image crops and map tiles were tested
  successfully through Microsoft Planetary Computer without an API key.
  Any future picker should show available captures, previews, source credits
  and the imagery date separately from Aer's weather forecast date. Cloudy
  captures and coverage gaps must remain visible as limitations.

References: [SkyFi pricing](https://skyfi.com/en/pricing),
[SkyFi EULA](https://skyfi.com/en/end-user-license-agreement),
[Microsoft Planetary Computer Data API](https://planetarycomputer.microsoft.com/docs/quickstarts/using-the-data-api/).

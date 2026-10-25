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

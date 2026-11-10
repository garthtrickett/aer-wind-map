# Aer forecast and hindcast storage plan

Status: proposed implementation, updated 10 November 2026 for primary-swell-only views. No bucket has been provisioned.

## Outcome

Store day 0–10 wind and wave forecasts once on the server, then serve prepared data to every browser. Changing forecast times should usually read cached data and prefetch the next time, without downloading and decoding global GRIB files again.

Historical ECWAM data already persists on the server. Extend that storage to a bucket as the archive grows, while keeping frequently used data nearby.

## What exists today

| Data | Current path | Gap |
| --- | --- | --- |
| Global wind map | Browser downloads ECMWF GRIB ranges and decodes with ecCodes WASM | No durable forecast cache; timeline currently +3 to +72 hours |
| Global primary swell map and flag | MFWAM spatial OM byte ranges, decoded in a browser worker; only `swell_wave_height`, `swell_wave_period`, `swell_wave_direction` | No durable forecast cache; 0.167° display grid sampled from 0.083° native cells |
| Historical primary and secondary swell | Persistent `/data/aer-wave-history.sqlite`, month and grid cell queue/cache | Stored on the server already; capacity should grow independently of the web volume |

The hindcast cache key includes source/version, 0.125° output grid cell, year and UTC month. Both swell partitions are retained together and shared across users. Closing the browser does not cancel server downloads. Boundary months support joining local calendar dates. The CY50R1 research hindcast is distinct from historical operational forecasts.

## Recommendation

Use an S3-compatible object bucket for immutable prepared forecast runs and historical month objects. Keep SQLite for job state, receipts and manifests, and a bounded local disk cache for hot objects. Avoid storing several global decoded forecast runs on the current 5 GiB application volume.

Cloudflare R2 is a candidate for read-heavy traffic because direct egress is not charged; requests and storage still have costs. AWS S3 is another option. Select the region and provider after measuring representative object sizes and latency from Railway and our users. Provisioning and credentials are a later implementation step. [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [S3 pricing](https://aws.amazon.com/s3/pricing/).

## Source and horizon

- Use ECMWF 0.25° open data for wind `10u`, `10v`, gust `10fg`/`10fg3`. Use MFWAM spatial OM files for the three primary-swell fields. Combined wave fields must not enter a published Aer layer.
- For ECMWF wind, use native steps 0–144 hours every 3 hours and 150–240 every 6 hours: 65 steps. MFWAM primary swell has its own run and three-hour steps; discover its actual horizon independently. Verify each cycle's objects before accepting it; start with 00/12 UTC cycles.
- Do not advertise interpolated values as native hourly forecasts. Show the run time, valid time, model and update age.
- At step zero, inspect gust accumulation metadata: a zero-length interval is not proof of calm gusts.
- Primary swell is absent from the sampled public ECMWF wave indices. Cache MFWAM primary-swell grids and point series with explicit run/source/version keys. Never fill missing primary swell with combined seas. Convert native OM propagation bearings to FROM bearings before publishing.
- ECMWF now also advertises 0.1° data, released later than 0.25°. That is a separate future resolution/capacity decision; retain 0.25° for the first implementation.

ECMWF's public origin is a short rolling archive, so Aer must capture each run while it is available. It is not a dependable way to retrieve a missed 2022–2025 run. Preserve attribution required by the data licence. [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data).

### Historical finite source probe (superseded wave-map source)

On 9 November, `2026110812` returned valid wind and wave indices at steps 0, 3, 144, 150 and 240. `2026110900` was not yet published. All sampled wave indices contained `mwd`; none contained `swh1`, `mwp1`, `mwd1`. This verifies these sampled steps, not every step of every cycle.

These measurements predate the primary-swell-only change and must not be used to size the MFWAM cache. Measure its three fields independently.

The former +3 hour six-field GRIB payload total was 3,430,257 bytes. Multiplying by 65 gives roughly 213 MiB per run; actual compression varies by step and field. A decoded 1440 × 721 Float32 field is 4,152,960 bytes. Six fields × 65 steps occupy approximately 1.51 GiB uncompressed per run. Two published runs plus one incoming run would occupy about 4.52 GiB before database, temporary files or other application data. Measure compressed objects before setting retention.

Private measurement receipt: `/home/gust/.local/state/aer-wave-ui-20261109/forecast-index-probe.json`.

## Forecast implementation phases

### 1. Measure a bounded sample

Download one representative run's selected fields and prepare one region at several native steps, including 0 and 240. Measure range bytes, decode CPU/RAM, prepared bytes, browser draw latency and cache-hit latency. Keep these jobs under shared host resource limits.

Choose lossless compressed binary tiles or contiguous patches, initially around 128 × 128 cells per layer, after measuring overhead. Keep u/v together for wind; keep height/period/direction together for waves. A three-field Float32 tile is 192 KiB before compression. Retain masks and circular direction semantics. Optional low-resolution global previews should have an explicit resolution label.

### 2. Build a durable producer

Use a bounded worker with a persistent queue and lease, separate from web request handling. Start with at most two transfers and one decoder; tune from measurements. Use indexed byte ranges, validate field metadata, expected geometry, timestamps and masks, and decode each downloaded field once.

Write objects under immutable keys such as:

```text
forecast/ecmwf-ifs/0p25/v1/{run}/{layer}/{step}/{tile}.bin.gz
forecast/ecmwf-ifs/0p25/v1/{run}/manifest.json
```

Only publish a run's ready manifest after all advertised objects have passed validation. Atomically update the current-run pointer; retain the last complete run while a new one is incomplete or fails. Persist checksums and receipts so a restart resumes safely without duplicate publication. Never mix fields or steps from different runs silently.

### 3. Serve prepared data

Provide manifest, viewport tile and point lookup endpoints. Use immutable cache headers and ETags for versioned objects; give the latest-run pointer a short TTL. Prefetch the next timeline step and nearby viewport tiles with strict memory/concurrency limits. Cancel stale viewport work and ignore stale replies.

Keep model credentials on the server. Climate objects may be shareable, but account records, saved spots and login tokens must remain separate. A cache hit must not call ECMWF or run the decoder. Add a separately keyed cache for the MFWAM point series rather than labelling it ECMWF.

### 4. Extend the timeline

Replace fixed three-hour timeline arithmetic with the manifest's native step array. Include day 0 through day 10 and show the 3-hour/6-hour spacing. Keep selected valid time consistent between map, flag and details. Mark unavailable/stale data clearly. Roll out behind a configuration flag with the existing browser path as a temporary fallback.

### 5. Bound operations

Set hard storage and object-count caps. Initially retain the current and previous complete forecast run plus bounded staging space; remove abandoned staging by age only after confirming it is not active. Track publication lag, last complete run, queue health and failed downloads. Keep forecasts and hindcasts under separate prefixes and retention policies.

Suggested server-only configuration: bucket endpoint/name, scoped access key/secret, `AER_FORECAST_CACHE_DIR`, local cache byte limit, retained run limit and worker concurrency. Use credentials restricted to the Aer prefixes. Choose real values after measurement; do not put secrets into browser bundles.

## Hindcast bucket migration

1. Add a storage interface supporting the current local store and bucket objects.
2. Store validated month objects under `hindcast/ecwam-cy50r1/v1/{experiment}/{grid-cell}/{year}/{month}.json.gz`. Preserve source/version, grid coordinates, both partitions, hourly times and missing-data masks.
3. Keep SQLite jobs, provider receipts, coverage, object keys and checksums. Use a bounded hot cache for frequently read months and summaries.
4. Validate a provider result, upload it, verify readback/checksum, then atomically mark it ready. Release the provider result only after persistence succeeds.
5. Migrate the two existing verified sample months first. Compare every value after readback and demonstrate rollback before removing their old copies. Preserve existing in-flight jobs and receipts.
6. Reuse a cell/month across all users and filters. A browser closing, changing partition or revisiting a month must not trigger another provider retrieval.
7. Keep historical processed data long term; forecast run expiry must never delete hindcast objects. Do not prefetch the whole world. Continue the existing authenticated preparation limits and public cached reads.

This is a storage change: it does not change the hindcast model, period definition, native resolution or the fact that it is a research hindcast. Keep a recoverable metadata database separately from bulk climate objects.

## Acceptance checks

- Restart during transfer, decode, upload and publication; recover without losing receipts or publishing partial runs.
- Verify every advertised step and field, coastal masks, 0°/360° averaging, zero-step gust metadata, and matching flag/map valid times.
- Demonstrate no upstream calls on a warm point or tile hit.
- Demonstrate ECMWF wind's 65 native steps through +240 hours and MFWAM primary swell's separately published native steps; reject incomplete new cycles while serving the previous complete run for that source.
- Check browser cancellation, stale replies, bounded memory and eviction without removing the current/fallback run.
- Measure targets on named devices/networks: warm point backend p95 below 200 ms; prefetched viewport/time changes around 300–500 ms; preserve at least 30 fps animation on the reference device. These are targets, not measured promises.
- For hindcasts, compare both migrated monthly samples value-for-value, then confirm local calendar boundaries, reused requests, source labels and server persistence after restart.

## Delivery order

1. Finish current wave animation, flag bearings and marker display fix.
2. Implement a measured forecast cache pilot and publish its latency/storage results.
3. Select and configure object storage, then ship the day 0–10 cache and timeline.
4. Migrate the historical cache using verified readback, preserving existing jobs.

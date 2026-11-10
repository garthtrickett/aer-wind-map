import assert from "node:assert/strict";
import { test } from "node:test";
import { currentPrimarySwellStep, discoverPrimarySwell, primarySwellDirectionFrom, primarySwellFrameUrl, primarySwellMapGrid } from "./primary-swell.ts";

test("primary swell discovery requires all three partition fields and a complete forecast horizon", async () => {
  const metadata = { completed: true, reference_time: "2026-11-09T12:00:00Z",
    valid_times: ["2026-11-09T12:00Z", "2026-11-09T15:00Z", "2026-11-12T12:00Z"],
    variables: ["swell_wave_height", "swell_wave_period", "swell_wave_direction"] };
  const fetcher = (value: unknown) => (async () => new Response(JSON.stringify(value))) as typeof fetch;
  const result = await discoverPrimarySwell(fetcher(metadata));
  assert.ok(result.ok);
  assert.equal(result.value.id, "2026110912");
  assert.equal(primarySwellFrameUrl(result.value, 24), "https://openmeteo.s3.amazonaws.com/data_spatial/meteofrance_wave/2026/11/09/1200Z/2026-11-10T1200.om");
  assert.equal(currentPrimarySwellStep(result.value, Date.parse("2026-11-10T11:15:00Z")), 24);
  assert.equal((await discoverPrimarySwell(fetcher({ ...metadata, variables: ["wave_height", "wave_period", "wave_direction"] }))).ok, false);
  assert.equal((await discoverPrimarySwell(fetcher({ ...metadata, valid_times: [] }))).ok, false);
  assert.throws(() => primarySwellFrameUrl(result.value, 4));
});

test("global display samples original cells, reverses latitude and preserves gaps and bearings", () => {
  const native = new Float32Array([1, 2, NaN, 4, 5, 6, 7, 8, 9, 10, 359, 12]);
  const grid = primarySwellMapGrid(native, 4, 3);
  assert.deepEqual([...grid.slice(0, 3)], [9, 359, 1]);
  assert.ok(Number.isNaN(grid[3]));
  assert.throws(() => primarySwellMapGrid(native, 4, 4));
});

test("native MFWAM propagation bearings match the public API's FROM convention", () => {
  assert.equal(primarySwellDirectionFrom(-177), 3, "Taiwan reference sample");
  assert.equal(primarySwellDirectionFrom(26), 206, "Bali reference sample");
  assert.equal(primarySwellDirectionFrom(180), 0);
  assert.equal(primarySwellDirectionFrom(-180), 0);
  assert.ok(Number.isNaN(primarySwellDirectionFrom(NaN)));
});

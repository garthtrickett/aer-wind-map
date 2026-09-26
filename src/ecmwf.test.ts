import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverLatest, forecastUrl, runCandidates } from "./ecmwf.ts";

test("candidate runs are unique and ordered newest first across midnight", () => {
  const candidates = runCandidates(new Date("2026-09-26T01:30:00Z"));
  assert.equal(candidates[0]?.id, "2026092600");
  assert.equal(candidates[1]?.id, "2026092518");
  assert.equal(new Set(candidates.map((run) => run.id)).size, candidates.length);
});

test("index and GRIB requests address the browser-accessible Google mirror", () => {
  const run = runCandidates(new Date("2026-09-26T01:30:00Z"))[0]!;
  const url = forecastUrl(run, 72, "index");
  assert.equal(url, "https://storage.googleapis.com/ecmwf-open-data/20260926/00z/ifs/0p25/oper/20260926000000-72h-oper-fc.index");
  assert.equal(forecastUrl(run, 3, "grib2").endsWith("-3h-oper-fc.grib2"), true);
});

test("discovery checks one cycle at a time and stops at the newest available run", async () => {
  const checked: string[] = [];
  let active = false;
  const fetcher = (async (url: string | URL | Request) => {
    assert.equal(active, false);
    active = true;
    checked.push(String(url));
    await Promise.resolve();
    active = false;
    return { ok: checked.length === 2 } as Response;
  }) as typeof fetch;
  const result = await discoverLatest(fetcher);
  assert.equal(result.ok, true);
  assert.equal(checked.length, 2);
  if (result.ok) assert.ok(checked[1]?.includes(result.value.id));
});

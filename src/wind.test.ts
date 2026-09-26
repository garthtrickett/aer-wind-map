import assert from "node:assert/strict";
import { test } from "node:test";
import { compassDirection, sampleWind, validTime, type WindField } from "./wind.ts";

const run = { date: "20260925", hour: 18, id: "2026092518", startedAt: "2026-09-25T18:00:00Z" };
const field: WindField = {
  run, step: 3, width: 4, height: 3, firstLatitude: 90, firstLongitude: 180, increment: 90,
  u: new Float32Array([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
  v: new Float32Array(12), gust: new Float32Array(12).fill(8),
};

test("samples the same wind on either side of the date line", () => {
  assert.deepEqual(sampleWind(field, 0, 180), sampleWind(field, 0, -180));
  assert.equal(sampleWind(field, 0, 179.5)?.speed, 4);
});

test("reports the meteorological source direction", () => {
  const sample = sampleWind(field, 0, 0);
  assert.equal(sample?.directionFrom, 270);
  assert.equal(compassDirection(sample!.directionFrom), "W");
  assert.equal(sample?.gust, 8);
});

test("rejects coordinates outside the grid and computes valid time", () => {
  assert.equal(sampleWind(field, 91, 0), null);
  assert.equal(sampleWind(field, Number.NaN, 0), null);
  assert.equal(validTime(field).toISOString(), "2026-09-25T21:00:00.000Z");
});

test("leaves missing wind unpainted and missing gust unavailable", () => {
  const missingWind = new Float32Array(field.u);
  missingWind[6] = Number.NaN;
  assert.equal(sampleWind({ ...field, u: missingWind }, 0, 0), null);

  const missingGust = new Float32Array(field.gust!);
  missingGust[6] = Number.NaN;
  assert.equal(sampleWind({ ...field, gust: missingGust }, 0, 0)?.gust, null);
});

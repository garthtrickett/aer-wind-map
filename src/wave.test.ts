import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleWave, type WaveField } from "./wave.ts";

const field: WaveField = {
  kind: "waves",
  run: { date: "20260926", hour: 6, id: "2026092606", startedAt: "2026-09-26T06:00:00Z" },
  step: 3, width: 4, height: 2, firstLatitude: 1, firstLongitude: 0, increment: 1,
  waveHeight: new Float32Array([1, 2, 3, 4, 1, 2, 3, 4]),
  wavePeriod: new Float32Array([8, 10, 12, 14, 8, 10, 12, 14]),
};

test("samples combined wave height and mean period at a location", () => {
  assert.deepEqual(sampleWave(field, 0.5, 0.5), { height: 1.5, period: 9 });
  assert.deepEqual(sampleWave(field, 0.5, 360.5), { height: 1.5, period: 9 });
  assert.equal(sampleWave(field, 2, 0.5), null);
});

test("uses available sea cells beside masked coastal cells", () => {
  const coast = { ...field, waveHeight: new Float32Array([1, Number.NaN, 3, 4, 1, 2, 3, 4]) };
  assert.deepEqual(sampleWave(coast, 0.5, 0.5), { height: 4 / 3, period: 26 / 3 });
  assert.deepEqual(sampleWave(coast, 1, 0.5), { height: 1, period: 8 });
});

test("reads the sea south of Bali when one ECMWF grid point is masked", () => {
  const bali: WaveField = {
    ...field, width: 2, height: 2, firstLatitude: -8.75, firstLongitude: 115, increment: 0.25,
    waveHeight: new Float32Array([1.6337926, Number.NaN, 1.8349645, 1.842777]),
    wavePeriod: new Float32Array([16.961231, Number.NaN, 15.925099, 15.754689]),
  };
  const reading = sampleWave(bali, -8.85, 115.1);
  assert.ok(reading);
  assert.ok(reading.height > 1.7 && reading.height < 1.8);
  assert.ok(reading.period > 16 && reading.period < 17);
  assert.equal(sampleWave(bali, -8.75, 115.25), null);
});

test("keeps masked points and missing wave-period pairs empty", () => {
  const coast = {
    ...field,
    waveHeight: new Float32Array([Number.NaN, 2, 3, 4, 1, 2, 3, 4]),
    wavePeriod: new Float32Array([8, Number.NaN, 12, 14, 8, 10, 12, 14]),
  };
  assert.equal(sampleWave(coast, 1, 0), null);
  assert.equal(sampleWave(coast, 1, 1), null);
  assert.equal(sampleWave(coast, 1, 0.5), null);
});

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

test("does not invent a wave reading where the model has missing cells", () => {
  const missing = { ...field, waveHeight: new Float32Array([Number.NaN, 2, 3, 4, 1, 2, 3, 4]) };
  assert.equal(sampleWave(missing, 1, 0), null);
});

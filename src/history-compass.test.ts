import assert from "node:assert/strict";
import { test } from "node:test";
import { bearingAt, bearingPoint, clockwiseSectorPath } from "./history-compass-geometry.ts";

test("compass bearings run clockwise from north", () => {
  for (const bearing of [0, 45, 90, 180, 270, 315]) {
    const point = bearingPoint(bearing, 100);
    assert.equal(bearingAt(point.x, point.y), bearing);
  }
});

test("compass sectors follow the same clockwise ranges as history scoring", () => {
  const northCrossing = clockwiseSectorPath(315, 45, 96, 112);
  const longArc = clockwiseSectorPath(45, 315, 96, 112);
  const full = clockwiseSectorPath(0, 360, 96, 112);
  assert.match(northCrossing, /A 112 112 0 0 1/);
  assert.match(longArc, /A 112 112 0 1 1/);
  assert.equal((full.match(/A 112 112/g) ?? []).length, 2);
  assert.equal((full.match(/A 96 96/g) ?? []).length, 2);
});

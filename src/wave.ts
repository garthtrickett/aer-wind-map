import type { ForecastRun, WindField } from "./wind.ts";

export type WaveField = Readonly<{
  kind: "waves";
  run: ForecastRun;
  step: number;
  width: number;
  height: number;
  firstLatitude: number;
  firstLongitude: number;
  increment: number;
  waveHeight: Float32Array;
  wavePeriod: Float32Array;
}>;

export type ForecastField = WindField | WaveField;
export type Layer = "wind" | "waves";

const COLOR_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 135, 199, 215],
  [1, 64, 184, 201],
  [2, 70, 189, 145],
  [3, 187, 206, 117],
  [4, 239, 187, 97],
  [6, 219, 128, 89],
  [8, 158, 89, 142],
];

export const waveColor = (height: number): readonly [number, number, number] => {
  for (let index = 1; index < COLOR_STOPS.length; index++) {
    const next = COLOR_STOPS[index]!;
    if (height <= next[0]) {
      const prior = COLOR_STOPS[index - 1]!;
      const fraction = Math.max(0, (height - prior[0]) / (next[0] - prior[0]));
      return [1, 2, 3].map((channel) => Math.round(prior[channel]! + (next[channel]! - prior[channel]!) * fraction)) as [number, number, number];
    }
  }
  return [158, 89, 142];
};

export const sampleWave = (field: WaveField, latitude: number, longitude: number): Readonly<{ height: number; period: number }> | null => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const y = (field.firstLatitude - latitude) / field.increment;
  if (y < 0 || y > field.height - 1) return null;
  const x = (((longitude - field.firstLongitude) % 360) + 360) % 360 / field.increment;
  const x0 = Math.floor(x) % field.width;
  const x1 = (x0 + 1) % field.width;
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const tx = x - Math.floor(x);
  const ty = y - y0;
  const corners = [
    { index: y0 * field.width + x0, weight: (1 - tx) * (1 - ty) },
    { index: y0 * field.width + x1, weight: tx * (1 - ty) },
    { index: y1 * field.width + x0, weight: (1 - tx) * ty },
    { index: y1 * field.width + x1, weight: tx * ty },
  ];
  let totalWeight = 0;
  let height = 0;
  let period = 0;
  for (const corner of corners) {
    if (corner.weight === 0) continue;
    const cornerHeight = field.waveHeight[corner.index]!;
    const cornerPeriod = field.wavePeriod[corner.index]!;
    if (!Number.isFinite(cornerHeight) || !Number.isFinite(cornerPeriod)) continue;
    totalWeight += corner.weight;
    height += cornerHeight * corner.weight;
    period += cornerPeriod * corner.weight;
  }
  return totalWeight > 0 ? { height: height / totalWeight, period: period / totalWeight } : null;
};

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

const interpolate = (values: Float32Array, field: WaveField, latitude: number, longitude: number): number => {
  const y = (field.firstLatitude - latitude) / field.increment;
  if (y < 0 || y > field.height - 1) return Number.NaN;
  const x = (((longitude - field.firstLongitude) % 360) + 360) % 360 / field.increment;
  const x0 = Math.floor(x) % field.width;
  const x1 = (x0 + 1) % field.width;
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const tx = x - Math.floor(x);
  const ty = y - y0;
  const top = values[y0 * field.width + x0]! * (1 - tx) + values[y0 * field.width + x1]! * tx;
  const bottom = values[y1 * field.width + x0]! * (1 - tx) + values[y1 * field.width + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
};

export const sampleWave = (field: WaveField, latitude: number, longitude: number): Readonly<{ height: number; period: number }> | null => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const height = interpolate(field.waveHeight, field, latitude, longitude);
  const period = interpolate(field.wavePeriod, field, latitude, longitude);
  return Number.isFinite(height) && Number.isFinite(period) ? { height, period } : null;
};

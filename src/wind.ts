export type ForecastRun = Readonly<{
  date: string;
  hour: number;
  startedAt: string;
  id: string;
}>;

export type WindField = Readonly<{
  kind: "wind";
  run: ForecastRun;
  step: number;
  width: number;
  height: number;
  firstLatitude: number;
  firstLongitude: number;
  increment: number;
  u: Float32Array;
  v: Float32Array;
  gust: Float32Array | null;
}>;

export type WindSample = Readonly<{
  u: number;
  v: number;
  speed: number;
  directionFrom: number;
  gust: number | null;
}>;

const wrap = (value: number, size: number): number => ((value % size) + size) % size;

const interpolate = (
  values: Float32Array,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  tx: number,
  ty: number,
): number => {
  const top = values[y0 * width + x0]! * (1 - tx) + values[y0 * width + x1]! * tx;
  const bottom = values[y1 * width + x0]! * (1 - tx) + values[y1 * width + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
};

export const sampleWind = (field: WindField, latitude: number, longitude: number): WindSample | null => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const y = (field.firstLatitude - latitude) / field.increment;
  if (y < 0 || y > field.height - 1) return null;
  const x = wrap(longitude - field.firstLongitude, 360) / field.increment;
  const x0 = Math.floor(x) % field.width;
  const x1 = (x0 + 1) % field.width;
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const tx = x - Math.floor(x);
  const ty = y - y0;
  const u = interpolate(field.u, field.width, x0, x1, y0, y1, tx, ty);
  const v = interpolate(field.v, field.width, x0, x1, y0, y1, tx, ty);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  const rawGust = field.gust === null ? null : interpolate(field.gust, field.width, x0, x1, y0, y1, tx, ty);
  return {
    u,
    v,
    speed: Math.hypot(u, v),
    // Meteorological bearings describe where the wind comes from. Arrows use
    // the opposite direction, where the wind is going.
    directionFrom: wrap(Math.atan2(-u, -v) * 180 / Math.PI, 360),
    gust: rawGust !== null && Number.isFinite(rawGust) ? rawGust : null,
  };
};

export const validTime = (field: Pick<WindField, "run" | "step">): Date =>
  new Date(Date.parse(field.run.startedAt) + field.step * 3_600_000);

export const compassDirection = (bearing: number): string =>
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8]!;

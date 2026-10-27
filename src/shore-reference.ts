export type ShoreHandle = "shoreLineStart" | "shoreLineEnd";
export const validShoreNormal = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 360;
export const wrapBearing = (bearing: number): number => ((bearing % 360) + 360) % 360;
export const relativeBearing = (bearing: number, reference: number): number => wrapBearing(bearing - reference + 180) - 180;
export const shoreLineBearing = (seaBearing: number): number => (seaBearing + 90) % 180;
export const shoreNormalFromLine = (line: number, currentSea: number): number => {
  if (!Number.isInteger(line) || line < 0 || line >= 180) return NaN;
  const first = wrapBearing(line + 90), second = wrapBearing(first + 180);
  return Math.abs(relativeBearing(first, currentSea)) <= Math.abs(relativeBearing(second, currentSea)) ? first : second;
};
export const shoreHandleBearing = (seaBearing: number, handle: ShoreHandle): number =>
  wrapBearing(seaBearing + (handle === "shoreLineStart" ? 90 : -90));
export const shoreNormalFromHandle = (bearing: number, handle: ShoreHandle): number =>
  wrapBearing(bearing + (handle === "shoreLineStart" ? -90 : 90));
export const relativeRange = (start: number, end: number, reference: number): Readonly<{ start: number; end: number; span: number }> => ({
  start: relativeBearing(start, reference), end: relativeBearing(end, reference),
  span: end >= start ? end - start : end - start + 360,
});
export const relativeAngleLabel = (angle: number): string => `${angle > 0 ? "+" : angle < 0 ? "−" : ""}${Math.abs(angle)}°`;

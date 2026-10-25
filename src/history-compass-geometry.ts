const center = 140;
const radians = (degrees: number): number => degrees * Math.PI / 180;

export const bearingPoint = (bearing: number, radius: number): Readonly<{ x: number; y: number }> => ({
  x: center + Math.sin(radians(bearing)) * radius,
  y: center - Math.cos(radians(bearing)) * radius,
});

export const bearingAt = (x: number, y: number): number =>
  (Math.round(Math.atan2(x - center, center - y) * 180 / Math.PI) + 360) % 360;

const position = (bearing: number, radius: number): string => {
  const point = bearingPoint(bearing, radius);
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
};

export const clockwiseSectorPath = (start: number, end: number, inner: number, outer: number): string => {
  const span = end >= start ? end - start : end - start + 360;
  const outerStart = position(start, outer);
  const innerStart = position(start, inner);
  if (span === 360) return [
    `M ${outerStart}`,
    `A ${outer} ${outer} 0 1 1 ${position(start + 180, outer)}`,
    `A ${outer} ${outer} 0 1 1 ${outerStart}`,
    `L ${innerStart}`,
    `A ${inner} ${inner} 0 1 0 ${position(start + 180, inner)}`,
    `A ${inner} ${inner} 0 1 0 ${innerStart} Z`,
  ].join(" ");
  const large = span > 180 ? 1 : 0;
  return `M ${outerStart} A ${outer} ${outer} 0 ${large} 1 ${position(start + span, outer)} ` +
    `L ${position(start + span, inner)} A ${inner} ${inner} 0 ${large} 0 ${innerStart} Z`;
};

export const clockwiseWedgePath = (start: number, end: number, radius: number): string => {
  const span = end >= start ? end - start : end - start + 360;
  if (!span) return "";
  if (span === 360) return `M ${position(start, radius)} A ${radius} ${radius} 0 1 1 ${position(start + 180, radius)} A ${radius} ${radius} 0 1 1 ${position(start, radius)} Z`;
  return `M 140 140 L ${position(start, radius)} A ${radius} ${radius} 0 ${span > 180 ? 1 : 0} 1 ${position(end, radius)} Z`;
};

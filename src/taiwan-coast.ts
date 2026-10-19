import { taiwanShorelines } from "./taiwan-shoreline.ts";
import type { Observation } from "./observations.ts";

export const taiwanCoastalWindDistanceKm = 5;

// Local equirectangular point-to-segment distance. At Taiwan's latitude and
// this 5 km cutoff, the generalised shoreline is the main approximation.
export const distanceToTaiwanCoastKm = (point: Readonly<{ latitude: number; longitude: number }>): number => {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return Infinity;
  const northScale = 111.195, eastScale = northScale * Math.cos(point.latitude * Math.PI / 180);
  let closestSquared = Infinity;
  for (const shoreline of taiwanShorelines) {
    for (let index = 1; index < shoreline.length; index++) {
      const start = shoreline[index - 1]!, end = shoreline[index]!;
      const x = (start[0] - point.longitude) * eastScale, y = (start[1] - point.latitude) * northScale;
      const dx = (end[0] - start[0]) * eastScale, dy = (end[1] - start[1]) * northScale;
      const lengthSquared = dx * dx + dy * dy;
      const fraction = lengthSquared ? Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared)) : 0;
      const distanceSquared = (x + fraction * dx) ** 2 + (y + fraction * dy) ** 2;
      closestSquared = Math.min(closestSquared, distanceSquared);
    }
  }
  return Math.sqrt(closestSquared);
};
export const nearTaiwanCoast = (point: Readonly<{ latitude: number; longitude: number }>): boolean =>
  distanceToTaiwanCoastKm(point) <= taiwanCoastalWindDistanceKm;

export const includeTaiwanWindStation = (station: Observation, coastalOnly: boolean): boolean => {
  if (!coastalOnly || station.kind !== "wind") return true;
  // CWA land sites and Taiwan's RC-prefixed airport reports. Offshore buoy
  // winds and stations elsewhere in the world remain available.
  const taiwan = station.source === "CWA" || station.source === "METAR" && station.id.startsWith("metar:RC");
  return !taiwan || nearTaiwanCoast(station);
};

import type * as L from "leaflet";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { ForecastField } from "./wave.ts";
import { createWindRenderer as createCanvasWindRenderer, windColor } from "./renderer-canvas.ts";
import { createWebGLWindRenderer } from "./renderer-webgl.ts";

export { windColor };

export const createWindRenderer = (
  map: L.Map,
  maplibre: MapLibreMap | null,
  color: HTMLCanvasElement,
  arrows: HTMLCanvasElement,
): Readonly<{ setField: (field: ForecastField | null) => void; redraw: () => void }> => {
  if (!maplibre) return createCanvasWindRenderer(map, color, arrows);
  color.hidden = true;
  return createWebGLWindRenderer(maplibre, arrows);
};

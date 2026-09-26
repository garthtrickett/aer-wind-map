import * as L from "leaflet";
import maplibreGL from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Point } from "./model.ts";

export type WindMap = Readonly<{
  map: L.Map;
  select: (point: Point | null) => void;
  center: () => Point;
}>;

const longitudeWithinWorld = (longitude: number): number =>
  ((longitude + 180) % 360 + 360) % 360 - 180;

export const createWindMap = (
  element: HTMLElement,
  onSelect: (point: Point) => void,
): WindMap => {
  setWorkerUrl(maplibreWorkerUrl);
  const map = L.map(element, {
    zoomControl: false,
    minZoom: 2,
    maxZoom: 10,
    zoomSnap: 0.25,
    worldCopyJump: true,
    preferCanvas: true,
  }).setView([28, 0], 2.25);

  const webgl2 = Boolean(document.createElement("canvas").getContext("webgl2"));
  if (webgl2) {
    maplibreGL({ style: "https://tiles.openfreemap.org/styles/positron" }).addTo(map);
  } else {
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 10,
      updateWhenIdle: true,
      attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    }).addTo(map);
  }
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  if (webgl2) map.attributionControl.addAttribution(
    '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  );
  map.attributionControl.addAttribution(
    '<a href="https://www.ecmwf.int/en/forecasts/datasets/open-data">ECMWF IFS</a> · CC BY 4.0',
  );

  let marker: L.CircleMarker | null = null;
  map.on("click", (event: L.LeafletMouseEvent) =>
    onSelect({ latitude: event.latlng.lat, longitude: longitudeWithinWorld(event.latlng.lng) }),
  );

  return {
    map,
    center: () => ({ latitude: map.getCenter().lat, longitude: longitudeWithinWorld(map.getCenter().lng) }),
    select: (point) => {
      if (marker) { marker.remove(); marker = null; }
      if (point) {
        marker = L.circleMarker([point.latitude, point.longitude], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: "#082b3a",
          fillOpacity: 1,
        }).addTo(map);
      }
    },
  };
};

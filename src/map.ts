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
  { element, marker, onSelect }: Readonly<{ element: HTMLElement; marker: HTMLElement; onSelect: (point: Point) => void }>,
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
    maplibreGL({ style: "https://tiles.openfreemap.org/styles/positron", attributionControl: false }).addTo(map);
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

  let selected: Point | null = null;
  const positionMarker = (): void => {
    marker.hidden = selected === null;
    if (!selected) return;
    const nearestLongitude = selected.longitude + Math.round((map.getCenter().lng - selected.longitude) / 360) * 360;
    const position = map.latLngToContainerPoint([selected.latitude, nearestLongitude]);
    marker.style.left = `${position.x}px`;
    marker.style.top = `${position.y}px`;
  };
  map.on("move zoom resize", positionMarker);
  map.on("click", (event: L.LeafletMouseEvent) =>
    onSelect({ latitude: event.latlng.lat, longitude: longitudeWithinWorld(event.latlng.lng) }),
  );

  return {
    map,
    center: () => ({ latitude: map.getCenter().lat, longitude: longitudeWithinWorld(map.getCenter().lng) }),
    select: (point) => {
      selected = point;
      positionMarker();
    },
  };
};

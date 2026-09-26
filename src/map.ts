import * as L from "leaflet";
import maplibreGL from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Point } from "./model.ts";

export type WindMap = Readonly<{
  map: L.Map;
  select: (point: Point | null) => void;
  center: () => Point;
  screenPoint: (point: Point) => Readonly<{ x: number; y: number }>;
  pointAt: (position: Readonly<{ x: number; y: number }>) => Point;
}>;

const longitudeWithinWorld = (longitude: number): number =>
  ((longitude + 180) % 360 + 360) % 360 - 180;

export const createWindMap = (
  { element, flag, onSelect }: Readonly<{ element: HTMLElement; flag: HTMLElement; onSelect: (point: Point) => void }>,
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
  const screenPoint = (point: Point): Readonly<{ x: number; y: number }> => {
    const longitude = point.longitude + Math.round((map.getCenter().lng - point.longitude) / 360) * 360;
    const position = map.latLngToContainerPoint([point.latitude, longitude]);
    return { x: position.x, y: position.y };
  };
  const positionFlag = (): void => {
    flag.hidden = selected === null;
    if (!selected) return;
    const position = screenPoint(selected);
    const size = map.getSize();
    const panelWidth = size.x < 480 ? 220 : 245;
    const desiredLeft = -16;
    const panelLeft = Math.max(8 - position.x, Math.min(desiredLeft, size.x - panelWidth - position.x - 12));
    flag.style.left = `${position.x}px`;
    flag.style.top = `${position.y}px`;
    flag.style.setProperty("--flag-panel-left", `${panelLeft}px`);
    flag.style.setProperty("--flag-rise", `${Math.min(118, Math.max(78, position.y - 85))}px`);
    flag.classList.toggle("flag-below", position.y < 190);
  };
  map.on("move zoom resize", positionFlag);
  map.on("click", (event: L.LeafletMouseEvent) =>
    onSelect({ latitude: event.latlng.lat, longitude: longitudeWithinWorld(event.latlng.lng) }),
  );

  return {
    map,
    center: () => ({ latitude: map.getCenter().lat, longitude: longitudeWithinWorld(map.getCenter().lng) }),
    screenPoint,
    pointAt: (position) => {
      const size = map.getSize();
      const latitudeLongitude = map.containerPointToLatLng([
        Math.max(0, Math.min(position.x, size.x)),
        Math.max(0, Math.min(position.y, size.y)),
      ]);
      return {
        latitude: Math.max(-85.05112878, Math.min(latitudeLongitude.lat, 85.05112878)),
        longitude: longitudeWithinWorld(latitudeLongitude.lng),
      };
    },
    select: (point) => {
      selected = point;
      positionFlag();
    },
  };
};

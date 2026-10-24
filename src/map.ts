import * as L from "leaflet";
import maplibreGL from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl, type Map as MapLibreMap } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Point } from "./model.ts";
import type { SavedSpot } from "./saved-spots.ts";

export type WindMap = Readonly<{
  map: L.Map;
  maplibre: MapLibreMap | null;
  select: (point: Point | null) => void;
  center: () => Point;
  screenPoint: (point: Point) => Readonly<{ x: number; y: number }>;
  pointAt: (position: Readonly<{ x: number; y: number }>) => Point;
  focus: (point: Point) => void;
  setSavedSpots: (spots: readonly SavedSpot[]) => void;
}>;

const longitudeWithinWorld = (longitude: number): number =>
  ((longitude + 180) % 360 + 360) % 360 - 180;

export const createWindMap = (
  { element, flag, onSelect, onSavedSpotSelect }: Readonly<{
    element: HTMLElement; flag: HTMLElement; onSelect: (point: Point) => void; onSavedSpotSelect: (id: string) => void;
  }>,
): WindMap => {
  setWorkerUrl(maplibreWorkerUrl);
  const map = L.map(element, {
    zoomControl: false,
    minZoom: 1,
    maxZoom: 20,
    zoomSnap: 0,
    wheelDebounceTime: 0,
    worldCopyJump: true,
    preferCanvas: true,
  }).setView([28, 0], 2.25);

  let pinchFrame = 0;
  let pinchDelta = 0;
  let pinchPoint = L.point(0, 0);
  element.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientHeight : 1;
    const rect = element.getBoundingClientRect();
    pinchPoint = L.point(event.clientX - rect.left, event.clientY - rect.top);
    pinchDelta = Math.max(-0.5, Math.min(0.5, pinchDelta - event.deltaY * unit / 160));
    if (pinchFrame) return;
    pinchFrame = requestAnimationFrame(() => {
      pinchFrame = 0;
      const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + pinchDelta));
      pinchDelta = 0;
      map.setZoomAround(pinchPoint, zoom, { animate: false });
    });
  }, { capture: true, passive: false });

  const webgl2 = Boolean(document.createElement("canvas").getContext("webgl2"));
  let maplibre: MapLibreMap | null = null;
  if (webgl2) {
    const layer = maplibreGL({ style: "https://tiles.openfreemap.org/styles/positron", attributionControl: false }).addTo(map);
    maplibre = layer.getMaplibreMap();
  } else {
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      maxNativeZoom: 19,
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
  const savedLinkRenderer = L.svg();
  const savedLayer = L.layerGroup().addTo(map);
  const savedIcon = L.divIcon({ className: "saved-spot-icon", html: '<span aria-hidden="true"></span>',
    iconSize: [28, 28], iconAnchor: [14, 27] });
  const setSavedSpots = (spots: readonly SavedSpot[]): void => {
    savedLayer.clearLayers();
    const drawn = new Set<string>();
    for (const spot of spots) for (const id of spot.linkedSpotIds ?? []) {
      const peer = spots.find((item) => item.id === id);
      const key = [spot.id, id].sort().join(":");
      if (!peer || drawn.has(key)) continue;
      drawn.add(key);
      const label = document.createElement("span");
      label.textContent = `${spot.name} + ${peer.name}`;
      L.polyline([[spot.point.latitude, spot.point.longitude], [peer.point.latitude, peer.point.longitude]],
        { renderer: savedLinkRenderer, className: "saved-spot-link", color: "#167589", weight: 2, dashArray: "6 6", opacity: .8 }).bindTooltip(label).addTo(savedLayer);
    }
    for (const spot of spots) {
      const label = document.createElement("span");
      label.textContent = spot.name;
      L.marker([spot.point.latitude, spot.point.longitude], { icon: savedIcon, title: spot.name })
        .bindTooltip(label, { direction: "top", offset: [0, -18] })
        .on("click", () => onSavedSpotSelect(spot.id))
        .addTo(savedLayer);
    }
  };

  return {
    map,
    maplibre,
    setSavedSpots,
    focus: (point) => map.setView([point.latitude, point.longitude], Math.max(map.getZoom(), 6), { animate: true }),
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

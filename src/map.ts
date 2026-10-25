import { conditionSource, conditionSourceLabel } from "./history.ts";
import * as L from "leaflet";
import maplibreGL from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl, type Map as MapLibreMap, type VisibilitySpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Point } from "./model.ts";
import type { SavedSpot } from "./saved-spots.ts";
import type { Basemap, Satellite } from "./satellite.ts";

export type WindMap = Readonly<{
  map: L.Map;
  maplibre: MapLibreMap | null;
  select: (point: Point | null) => void;
  center: () => Point;
  screenPoint: (point: Point) => Readonly<{ x: number; y: number }>;
  pointAt: (position: Readonly<{ x: number; y: number }>) => Point;
  focus: (point: Point) => void;
  setSavedSpots: (spots: readonly SavedSpot[]) => void;
  setBasemap: (basemap: Basemap, satellite: Satellite | null) => void;
}>;

const longitudeWithinWorld = (longitude: number): number =>
  ((longitude + 180) % 360 + 360) % 360 - 180;

export const createWindMap = (
  { element, flag, onSelect, onSavedSpotSelect, onSatelliteError }: Readonly<{
    element: HTMLElement; flag: HTMLElement; onSelect: (point: Point) => void; onSavedSpotSelect: (id: string) => void;
    onSatelliteError: () => void;
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
  let streetRaster: L.TileLayer | null = null;
  if (webgl2) {
    const layer = maplibreGL({ style: "https://tiles.openfreemap.org/styles/positron", attributionControl: false }).addTo(map);
    maplibre = layer.getMaplibreMap();
  } else {
    streetRaster = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
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

  let basemap: Basemap = "map";
  let satellite: Satellite | null = null;
  let satelliteRaster: L.TileLayer | null = null;
  let streetLayers: readonly Readonly<{ id: string; visibility: VisibilitySpecification }>[] | null = null;
  let renderedSatellite: Satellite | null = null;
  let satelliteAttribution = "";
  let showingStreetAttribution = webgl2;
  const streetAttribution = '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const logo = L.DomUtil.create("a", "satellite-logo");
  logo.href = "https://www.maptiler.com/"; logo.target = "_blank"; logo.rel = "noopener noreferrer"; logo.hidden = true;
  const logoImage = L.DomUtil.create("img", "", logo);
  logoImage.alt = "MapTiler"; logoImage.width = 100; logoImage.height = 25;
  const LogoControl = L.Control.extend({ onAdd: () => logo });
  new LogoControl({ position: "bottomleft" }).addTo(map);
  L.DomEvent.disableClickPropagation(logo);
  const applyBasemap = (): void => {
    const active = basemap === "satellite" && satellite !== null;
    logo.hidden = !active;
    if (active && !logoImage.src) logoImage.src = "https://api.maptiler.com/resources/logo.svg";
    if (maplibre && streetLayers) {
      if (satellite && satellite !== renderedSatellite && maplibre.getSource("aer-satellite")) {
        maplibre.removeLayer("aer-satellite"); maplibre.removeSource("aer-satellite");
      }
      if (satellite && !maplibre.getSource("aer-satellite")) {
        maplibre.addSource("aer-satellite", { type: "raster", tiles: [...satellite.tiles], tileSize: satellite.tileSize,
          minzoom: satellite.minZoom, maxzoom: satellite.maxZoom });
        maplibre.addLayer({ id: "aer-satellite", type: "raster", source: "aer-satellite", layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } },
          maplibre.getLayer("aer-wind") ? "aer-wind" : undefined);
      }
      for (const layer of streetLayers) maplibre.setLayoutProperty(layer.id, "visibility", active ? "none" : layer.visibility);
      if (maplibre.getLayer("aer-satellite")) maplibre.setLayoutProperty("aer-satellite", "visibility", active ? "visible" : "none");
      if (active && showingStreetAttribution) { map.attributionControl.removeAttribution(streetAttribution); showingStreetAttribution = false; }
      else if (!active && !showingStreetAttribution) { map.attributionControl.addAttribution(streetAttribution); showingStreetAttribution = true; }
    } else if (streetRaster) {
      if (active && satellite) {
        if (satellite !== renderedSatellite) { satelliteRaster?.remove(); satelliteRaster = null; }
        if (!satelliteRaster) satelliteRaster = L.tileLayer(satellite.tiles[0], { tileSize: satellite.tileSize,
          zoomOffset: satellite.tileSize === 512 ? -1 : 0, maxZoom: 20, minNativeZoom: satellite.minZoom, maxNativeZoom: satellite.maxZoom,
          updateWhenIdle: true, className: "satellite-tile" }).on("tileerror", () => { if (basemap === "satellite") onSatelliteError(); });
        streetRaster.remove();
        if (!map.hasLayer(satelliteRaster)) satelliteRaster.addTo(map);
      } else {
        satelliteRaster?.remove();
        if (!map.hasLayer(streetRaster)) streetRaster.addTo(map);
      }
    }
    if (satellite) renderedSatellite = satellite;
    if (satelliteAttribution) map.attributionControl.removeAttribution(satelliteAttribution);
    if (active && satellite) {
      // Preserve provider credits as text, without injecting upstream markup.
      const text = new DOMParser().parseFromString(satellite.attribution, "text/html").body.textContent ?? "";
      satelliteAttribution = `<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">© MapTiler</a> · ${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`;
      map.attributionControl.addAttribution(satelliteAttribution);
    }
    element.dataset.basemap = active ? "satellite" : "map";
  };
  if (maplibre) {
    maplibre.once("load", () => { streetLayers = maplibre!.getStyle().layers.filter((layer) => layer.id !== "aer-wind")
      .map((layer) => ({ id: layer.id, visibility: layer.layout?.visibility ?? "visible" })); applyBasemap(); });
    maplibre.on("error", (event) => { if (basemap === "satellite" && "sourceId" in event && event.sourceId === "aer-satellite") onSatelliteError(); });
  }

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
      const source = conditionSource(spot.criteria);
      const title = `${spot.name} · ${conditionSourceLabel(spot.criteria)}`;
      label.textContent = title;
      const icon = L.divIcon({ className: `saved-spot-icon saved-spot-${source}`,
        html: `<span aria-hidden="true">${source === "both" ? "W+S" : source === "wind" ? "W" : "S"}</span>`,
        iconSize: [34, 36], iconAnchor: [17, 35] });
      L.marker([spot.point.latitude, spot.point.longitude], { icon, title })
        .bindTooltip(label, { direction: "top", offset: [0, -18] })
        .on("click", () => onSavedSpotSelect(spot.id))
        .addTo(savedLayer);
    }
  };

  return {
    map,
    maplibre,
    setSavedSpots,
    setBasemap: (next, data) => { basemap = next; satellite = data; applyBasemap(); },
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

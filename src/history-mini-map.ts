import * as L from "leaflet";
import type { Point } from "./model.ts";
import { loadSatellite, type SatelliteResult } from "./satellite.ts";

const imageryRequests = new Map<string, Promise<SatelliteResult>>();
const imageryFor = (url: string): Promise<SatelliteResult> => {
  const cached = imageryRequests.get(url);
  if (cached) return cached;
  const request = loadSatellite(url).then((result) => {
    if (!result.ok) imageryRequests.delete(url); // Opening the panel again can retry a failed request.
    return result;
  });
  imageryRequests.set(url, request);
  return request;
};

/** Own the clipped Leaflet map and its external credits, independently of the main map. */
export const createHistoryMiniMap = (element: HTMLElement, credits: HTMLElement, point: Point, zoom: number,
  imageryUrl: string | null): Readonly<{ remove: () => void; setZoom: (zoom: number) => void }> => {
  const map = L.map(element, {
    zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
    zoomSnap: 0, minZoom: 6, maxZoom: 20,
  }).setView([point.latitude, point.longitude], zoom);
  const attribution = L.control.attribution({ prefix: false }).addTo(map);
  const attributionElement = attribution.getContainer()!;
  attributionElement.classList.remove("leaflet-control");
  const logo = L.DomUtil.create("a", "history-map-logo");
  logo.href = "https://www.maptiler.com/"; logo.target = "_blank"; logo.rel = "noopener noreferrer"; logo.hidden = true;
  const image = L.DomUtil.create("img", "", logo);
  image.alt = "MapTiler"; image.width = 80; image.height = 20;
  const notice = L.DomUtil.create("p", "history-map-notice");
  notice.setAttribute("role", "status");
  credits.replaceChildren(logo, attributionElement, notice);

  let removed = false;
  let layer: L.TileLayer | null = null;
  const street = (message = ""): void => {
    if (removed) return;
    layer?.remove();
    logo.hidden = true;
    element.dataset.basemap = "map";
    notice.textContent = message;
    layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      minZoom: 0, maxZoom: 20, maxNativeZoom: 19,
      attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
    }).addTo(map);
  };
  if (!imageryUrl) street();
  else {
    element.dataset.basemap = "loading";
    notice.textContent = "Loading satellite imagery…";
    void imageryFor(imageryUrl).then((result) => {
      if (removed) return;
      if (!result.ok) { street("Satellite unavailable; showing street map."); return; }
      const data = result.data;
      // The same provider text is shown safely outside the circular clipping mask.
      const provider = document.createElement("span");
      provider.textContent = new DOMParser().parseFromString(data.attribution, "text/html").body.textContent ?? "";
      layer = L.tileLayer(data.tiles[0], {
        minZoom: 0, maxZoom: 20, minNativeZoom: data.minZoom, maxNativeZoom: Math.min(data.maxZoom, 20), tileSize: data.tileSize,
        zoomOffset: data.tileSize === 512 ? -1 : 0,
        attribution: `<a href="https://www.maptiler.com/" target="_blank" rel="noopener noreferrer">© MapTiler</a> · ${provider.innerHTML}`,
      });
      layer.once("tileerror", () => street("Satellite unavailable; showing street map."));
      element.dataset.basemap = "satellite";
      notice.textContent = "";
      logo.hidden = false;
      image.src = "https://api.maptiler.com/resources/logo.svg";
      layer.addTo(map);
    });
  }
  const frame = requestAnimationFrame(() => { if (!removed) map.invalidateSize(); });
  return {
    remove: () => { removed = true; cancelAnimationFrame(frame); layer?.off(); map.remove(); credits.replaceChildren(); },
    setZoom: (next) => map.setZoom(next, { animate: false }),
  };
};

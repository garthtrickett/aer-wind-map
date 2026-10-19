import * as L from "leaflet";
import { html, svg, type TemplateResult } from "lit-html";
import type { HistoryCriteria } from "./history.ts";
import type { Point } from "./model.ts";
import { bearingAt, bearingPoint, clockwiseSectorPath } from "./history-compass-geometry.ts";

export const bearingFromPointer = (event: PointerEvent, svg: SVGSVGElement): number => {
  const rect = svg.getBoundingClientRect();
  return bearingAt((event.clientX - rect.left) * 280 / rect.width, (event.clientY - rect.top) * 280 / rect.height);
};

export type BearingHandle = "windFromStart" | "windFromEnd" | "swellFromStart" | "swellFromEnd";
export const defaultHistoryMapZoom = 11;
const maxHistoryMapZoom = 20;

const handle = (kind: BearingHandle, bearing: number, radius: number, label: string, visualBearing = bearing): TemplateResult => {
  const point = bearingPoint(visualBearing, radius);
  return svg`<circle class=${`compass-handle ${kind.startsWith("wind") ? "wind" : "swell"}`}
    data-bearing-handle=${kind} cx=${point.x} cy=${point.y} r="9" tabindex="0" role="slider"
    aria-label=${label} aria-valuemin="0" aria-valuemax=${kind.endsWith("End") ? "360" : "359"}
    aria-valuenow=${String(bearing)} aria-valuetext=${`${bearing} degrees`} />`;
};

export const historyCompassView = (criteria: HistoryCriteria): TemplateResult => html`
  <div class="history-compass" aria-label="Map and selected wind and swell directions">
    <div class="history-compass-stage">
      <div id="history-mini-map" class="history-mini-map" aria-hidden="true"></div>
      <svg class="history-compass-overlay" viewBox="0 0 280 280" aria-label="Drag the dots to set clockwise direction ranges">
        <circle class="compass-ring" cx="140" cy="140" r="130" />
        <path class="compass-sector wind" d=${clockwiseSectorPath(criteria.windFromStart, criteria.windFromEnd, 114, 130)} />
        <path class="compass-sector swell" d=${clockwiseSectorPath(criteria.swellFromStart, criteria.swellFromEnd, 96, 112)} />
        <circle class="compass-inner-ring" cx="140" cy="140" r="95" />
        ${handle("windFromStart", criteria.windFromStart, 121, "Wind range start dot")}
        ${handle("windFromEnd", criteria.windFromEnd, 123, "Wind range end dot", criteria.windFromEnd === 360 && criteria.windFromStart === 0 ? 350 : criteria.windFromEnd)}
        ${handle("swellFromStart", criteria.swellFromStart, 103, "Swell range start dot")}
        ${handle("swellFromEnd", criteria.swellFromEnd, 105, "Swell range end dot", criteria.swellFromEnd === 360 && criteria.swellFromStart === 0 ? 348 : criteria.swellFromEnd)}
        <circle class="compass-spot-halo" cx="140" cy="140" r="10" />
        <circle class="compass-spot" cx="140" cy="140" r="4" />
      </svg>
      <span class="compass-cardinal north">N</span><span class="compass-cardinal east">E</span>
      <span class="compass-cardinal south">S</span><span class="compass-cardinal west">W</span>
    </div>
    <div class="history-compass-key"><span><i class="wind"></i>Wind from</span><span><i class="swell"></i>Swell from</span></div>
    <p>Drag a dot to change a bearing</p>
    <div class="history-map-zoom-head"><label for="history-map-zoom">Map zoom</label><output id="history-map-zoom-value" for="history-map-zoom">11</output></div>
    <div class="history-map-zoom-control"><span aria-hidden="true">−</span>
      <input id="history-map-zoom" type="range" min="6" max=${String(maxHistoryMapZoom)} step="0.25" value="11" />
      <span aria-hidden="true">+</span></div>
    <a class="history-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
  </div>`;

export const createHistoryMiniMap = (element: HTMLElement, point: Point, zoom: number): Readonly<{ remove: () => void; setZoom: (zoom: number) => void }> => {
  const map = L.map(element, {
    zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
    zoomSnap: 0, minZoom: 6, maxZoom: maxHistoryMapZoom,
  }).setView([point.latitude, point.longitude], zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    minZoom: 0, maxZoom: maxHistoryMapZoom, maxNativeZoom: 19,
  }).addTo(map);
  requestAnimationFrame(() => map.invalidateSize());
  return { remove: () => map.remove(), setZoom: (next) => map.setZoom(next, { animate: false }) };
};

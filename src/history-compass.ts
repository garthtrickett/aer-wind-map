import { html, svg, nothing, type TemplateResult } from "lit-html";
import { conditionSource, type HistoryCriteria } from "./history.ts";
import type { CompassReading } from "./compass-forecast.ts";
import { bearingAt, bearingPoint, clockwiseSectorPath, clockwiseWedgePath } from "./history-compass-geometry.ts";
import { defaultHistoryMapZoom, minHistoryMapZoom, maxHistoryMapZoom } from "./history-map-settings.ts";
import { shoreReferenceOverlay } from "./shore-reference-view.ts";

export const bearingFromPointer = (event: PointerEvent, svg: SVGSVGElement): number => {
  const rect = svg.getBoundingClientRect();
  return bearingAt((event.clientX - rect.left) * 280 / rect.width, (event.clientY - rect.top) * 280 / rect.height);
};

export type BearingHandle = "windFromStart" | "windFromEnd" | "swellFromStart" | "swellFromEnd";

const handle = (kind: BearingHandle, bearing: number, radius: number, label: string, visualBearing = bearing): TemplateResult => {
  const point = bearingPoint(visualBearing, radius);
  return svg`<circle class=${`compass-handle ${kind.startsWith("wind") ? "wind" : "swell"}`}
    data-bearing-handle=${kind} cx=${point.x} cy=${point.y} r="9" tabindex="0" role="slider"
    aria-label=${label} aria-valuemin="0" aria-valuemax=${kind.endsWith("End") ? "360" : "359"}
    aria-valuenow=${String(bearing)} aria-valuetext=${`${bearing} degrees`} />`;
};

const range = (kind: "wind" | "swell", start: number, end: number, radius: number): TemplateResult => svg`
  <path class=${`compass-area ${kind}`} d=${clockwiseWedgePath(start, end, radius)} />
  ${start === 0 && end === 360 ? nothing : [start, end].map((bearing) => {
    const point = bearingPoint(bearing, radius);
    return svg`<line class=${`compass-boundary ${kind}`} x1="140" y1="140" x2=${point.x} y2=${point.y} />`;
  })}`;
const current = (kind: "wind" | "swell", direction: number | null | undefined, radius: number): TemplateResult | typeof nothing => {
  if (direction === null || direction === undefined) return nothing;
  const point = bearingPoint(direction, radius);
  return svg`<g class=${`compass-current ${kind}`} data-direction=${direction} role="img" aria-label=${`${kind === "wind" ? "Wind" : "Swell"} forecast from ${Math.round(direction)} degrees`}>
    <line class="compass-current-halo" x1="140" y1="140" x2=${point.x} y2=${point.y} />
    <line class="compass-current-ray" x1="140" y1="140" x2=${point.x} y2=${point.y} />
    <path class="compass-current-arrow" d="M -4 -31 L 0 -22 L 4 -31" transform=${`translate(140 140) rotate(${direction})`} />
  </g>`;
};

export const historyCompassView = (criteria: HistoryCriteria, reading: CompassReading | null = null, mapZoom = defaultHistoryMapZoom, shoreNormal: number | null = null): TemplateResult => html`
  <div class="history-compass" aria-label="Map and selected wind and swell directions">
    <div class="history-compass-stage">
      <div id="history-mini-map" class="history-mini-map" aria-hidden="true"></div>
      <svg class="history-compass-overlay" viewBox="0 0 280 280" aria-label="Drag the dots to set clockwise direction ranges">
        ${conditionSource(criteria) !== "swell" ? range("wind", criteria.windFromStart, criteria.windFromEnd, 130) : nothing}
        ${conditionSource(criteria) !== "wind" ? range("swell", criteria.swellFromStart, criteria.swellFromEnd, 112) : nothing}
        <circle class="compass-ring" cx="140" cy="140" r="130" />
        <path class="compass-sector wind" d=${clockwiseSectorPath(criteria.windFromStart, criteria.windFromEnd, 114, 130)} />
        <path class="compass-sector swell" d=${clockwiseSectorPath(criteria.swellFromStart, criteria.swellFromEnd, 96, 112)} />
        <circle class="compass-inner-ring" cx="140" cy="140" r="95" />
        ${conditionSource(criteria) !== "swell" ? current("wind", reading?.wind?.direction, 130) : nothing}
        ${conditionSource(criteria) !== "wind" ? current("swell", reading?.swell?.direction, 112) : nothing}
        ${shoreReferenceOverlay(shoreNormal)}
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
    <div class="history-map-zoom-head"><label for="history-map-zoom">Map zoom</label><output id="history-map-zoom-value" for="history-map-zoom">${mapZoom}</output></div>
    <div class="history-map-zoom-control"><span aria-hidden="true">−</span>
      <input id="history-map-zoom" type="range" min=${String(minHistoryMapZoom)} max=${String(maxHistoryMapZoom)} step="0.25" .value=${String(mapZoom)} />
      <span aria-hidden="true">+</span></div>
    <div class="history-map-credit"></div>
  </div>`;

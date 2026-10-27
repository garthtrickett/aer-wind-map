import { html, svg, nothing, type TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { HistoryCriteria } from "./history.ts";
import { conditionSource } from "./history.ts";
import type { Proposal } from "./model.ts";
import { bearingPoint } from "./history-compass-geometry.ts";
import { compassDirection } from "./wind.ts";
import { shoreLineBearing, shoreNormalFromLine, shoreHandleBearing, relativeRange, relativeAngleLabel, wrapBearing, type ShoreHandle } from "./shore-reference.ts";

export const shoreReferenceOverlay = (seaBearing: number | null): TemplateResult | typeof nothing => {
  if (seaBearing === null) return nothing;
  const first = bearingPoint(seaBearing + 90, 80), second = bearingPoint(seaBearing - 90, 80);
  const sea = bearingPoint(seaBearing, 76), land = bearingPoint(seaBearing + 180, 70), label = bearingPoint(seaBearing, 62);
  return svg`<g class="shore-reference-overlay" aria-label="Beach or reef alignment and sea side">
    <line class="shore-line-halo" x1=${first.x} y1=${first.y} x2=${second.x} y2=${second.y} />
    <line class="shore-line" x1=${first.x} y1=${first.y} x2=${second.x} y2=${second.y} />
    <line class="shore-normal" x1=${land.x} y1=${land.y} x2=${sea.x} y2=${sea.y} />
    <path class="shore-sea-arrow" d="M -4 7 L 0 0 L 4 7" transform=${`translate(${sea.x} ${sea.y}) rotate(${seaBearing})`} />
    <text class="shore-sea-label" x=${label.x} y=${label.y} text-anchor="middle" dominant-baseline="central">SEA</text>
    ${(["shoreLineStart", "shoreLineEnd"] as const).map((handle: ShoreHandle, index) => {
      const point = index === 0 ? first : second;
      return svg`<circle class="shore-handle" data-shore-handle=${handle} cx=${point.x} cy=${point.y} r="9" tabindex="0" role="slider"
        aria-label=${`Beach/reef line ${index === 0 ? "first" : "second"} dot`} aria-valuemin="0" aria-valuemax="359"
        aria-valuenow=${String(shoreHandleBearing(seaBearing, handle))} aria-valuetext=${`${shoreLineBearing(seaBearing)} degree beach/reef line; sea toward ${compassDirection(seaBearing)}`} />`;
    })}
  </g>`;
};

const rangeRow = (name: string, start: number, end: number, reference: number): TemplateResult => {
  const range = relativeRange(start, end, reference);
  return html`<tr data-relative-range=${name.toLowerCase()}><th scope="row">${name}</th>
    ${range.span === 360 ? html`<td colspan="2">All directions</td>` : html`<td>${relativeAngleLabel(range.start)}</td><td>${relativeAngleLabel(range.end)}</td>`}
    <td>${range.span}°${range.span === 0 ? " (single bearing)" : ""}</td></tr>`;
};

export const shoreReferenceControls = (normal: number | null, criteria: HistoryCriteria, propose: (proposal: Proposal) => void): TemplateResult => {
  const update = (normal: number | null) => propose({ kind: "historyShoreNormalChanged", normal });
  return html`<section class="shore-reference-controls" aria-label="Beach and reef angle">
    ${normal === null ? html`<button type="button" class="shore-set" @click=${() => update(270)}>Set beach / reef angle</button>` : html`
      <div class="shore-reference-heading"><h4>Beach / reef angle</h4><button type="button" @click=${() => update(null)}>Clear alignment</button></div>
      <p>Drag the purple dots parallel to the beach or reef. Point SEA toward the water.</p>
      <div class="shore-reference-inputs"><label>Beach / reef line
        <span><input type="number" min="0" max="179" step="1" .value=${live(String(shoreLineBearing(normal)))}
          @change=${(event: Event) => update(shoreNormalFromLine((event.target as HTMLInputElement).valueAsNumber, normal))} />°</span>
      </label><button type="button" @click=${() => update(wrapBearing(normal + 180))}>Flip sea side</button></div>
      <p class="shore-reference-sea">Sea toward ${compassDirection(normal)} ${normal}°</p>
      <table class="shore-relative-ranges"><caption>Angles from the perpendicular</caption><thead><tr><th scope="col">Range</th><th scope="col">Start</th><th scope="col">End</th><th scope="col">Width</th></tr></thead>
        <tbody>${conditionSource(criteria) !== "swell" ? rangeRow("Wind", criteria.windFromStart, criteria.windFromEnd, wrapBearing(normal + 180)) : nothing}
          ${conditionSource(criteria) !== "wind" ? rangeRow("Swell", criteria.swellFromStart, criteria.swellFromEnd, normal) : nothing}</tbody>
      </table>
      <p class="shore-reference-note">Wind 0° = directly offshore (from land). Swell 0° = straight in (from sea).
        + clockwise; − anticlockwise. Width follows your clockwise range.</p>
    `}
  </section>`;
};

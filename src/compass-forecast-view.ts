import { html, nothing, type TemplateResult } from "lit-html";
import { compassDirection } from "./wind.ts";
import type { CompassForecast, CompassForecastProposal } from "./compass-forecast-model.ts";
import type { CompassReading } from "./compass-forecast.ts";
import { displayDateTime } from "./dates.ts";

const direction = (bearing: number | null): string => bearing === null ? "Direction unavailable" : `${compassDirection(bearing)} ${Math.round(bearing)}°`;
export const compassForecastView = (panel: CompassForecast, reading: CompassReading | null,
  propose: (proposal: CompassForecastProposal) => void): TemplateResult => html`
  <section class="compass-forecast" aria-label="Wind and swell direction forecast">
    <div class="compass-forecast-controls"><label>Directions for
      <select aria-label="Compass forecast time" .value=${panel.mode}
        @change=${(event: Event) => propose({ kind: "compassTimeModeChanged", mode: (event.target as HTMLSelectElement).value as "now" | "map" })}>
        <option value="now">Now</option><option value="map">Map forecast time</option>
      </select></label>
      <button type="button" aria-label="Refresh compass forecast" @click=${() => propose({ kind: "compassForecastRefresh" })}>↻</button></div>
    ${reading ? html`<p class="compass-forecast-time">${displayDateTime(reading.time * 1000, reading.timezone)} · model forecast</p>` : nothing}
    ${panel.phase === "loading" || panel.phase === "needsData" ? html`<p role="status">Loading directions…</p>`
      : panel.phase === "failed" ? html`<p role="status">Direction forecasts unavailable. Try refreshing.</p>`
      : panel.mode === "map" && !reading ? html`<p role="status">Map forecast time is not available yet.</p>` : nothing}
    ${panel.phase === "ready" ? html`
      ${panel.source !== "swell" ? html`<p class="compass-reading wind"><strong>Wind</strong>
        <span>${reading?.wind ? html`${direction(reading.wind.direction)}${reading.wind.speedKmh !== null ? ` · ${reading.wind.speedKmh.toFixed(1)} km/h` : ""}` : "No wind forecast for this hour"}</span>
        ${reading?.wind ? html`<small>${reading.wind.calm ? "Calm: direction ignored" : reading.wind.direction === null ? "No direction to compare"
          : reading.wind.fits ? "Direction inside range" : "Direction outside range"}</small>` : nothing}</p>` : nothing}
      ${panel.source !== "wind" ? html`<p class="compass-reading swell"><strong>Primary swell</strong>
        <span>${reading?.swell ? html`${reading.swell.height === 0 ? "No swell" : direction(reading.swell.direction)}${reading.swell.height !== null ? ` · ${reading.swell.height.toFixed(1)} m` : ""}${reading.swell.period !== null ? ` · ${reading.swell.period.toFixed(1)} s` : ""}` : "No swell forecast for this hour"}</span>
        ${reading?.swell ? html`<small>${reading.swell.direction === null ? "No direction to compare" : reading.swell.fits ? "Direction inside range" : "Direction outside range"}</small>` : nothing}</p>` : nothing}
    ` : nothing}
    <p class="compass-forecast-note">Solid edges: your ranges. Dashed lines: forecast directions from. ${panel.source !== "swell" ? "ECMWF wind." : ""} ${panel.source !== "wind" ? "MFWAM primary swell (hourly interpolation)." : ""} Not station observations.</p>
  </section>`;

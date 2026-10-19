import { html, nothing, type TemplateResult } from "lit-html";
import { observationDirection as compassDirection } from "./observations.ts";
import { observationQuery, type ObservationProposal, type ObservationsState } from "./observations-model.ts";

const timeLabel = (instant: string): string => new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
}).format(new Date(instant));
export const observationsView = (state: ObservationsState, propose: (proposal: ObservationProposal) => void, now: number): TemplateResult => {
  const station = state.data?.stations.find((item) => item.id === state.selectedId);
  const active = state.buoys || state.wind;
  const stale = station && now - Date.parse(station.observedAt) > 3 * 3600_000;
  return html`
    ${state.open ? html`<section class="observations-panel saved-spots-panel" aria-label="Observation layers">
      <div class="saved-spots-head"><strong>Observations</strong><button aria-label="Close observations" @click=${() => propose({ kind: "observationsToggled" })}>×</button></div>
      <p>Measured conditions at reporting stations.</p>
      <label><input type="checkbox" .checked=${state.buoys} @change=${() => propose({ kind: "observationLayerToggled", layer: "buoys" })} /> <span class="observation-key buoy-key">≈</span> Wave buoys</label>
      <label><input type="checkbox" .checked=${state.wind} @change=${() => propose({ kind: "observationLayerToggled", layer: "wind" })} /> <span class="observation-key wind-key">↑</span> Wind stations</label>
      <div class="observation-status" role="status">${!active ? "Choose a layer, then zoom into an area."
        : !observationQuery(state) ? "Zoom closer to see stations (zoom 5+)."
        : state.phase === "loading" || state.phase === "needsData" ? "Loading station observations…"
        : state.error || `${state.data?.stations.length ?? 0} reporting stations in this view.`}</div>
      ${state.data?.issues.map((issue) => html`<p class="observation-warning">${issue.source}: ${issue.message}</p>`)}
      ${observationQuery(state) ? html`<button class="observations-refresh" ?disabled=${state.phase === "loading"} @click=${() => propose({ kind: "observationsRefreshed" })}>Refresh readings</button>` : nothing}
      <p class="observation-note">Latest reports, independent of the forecast slider. Coverage varies by region. Grey markers have reports over 3 hours old.</p>
      <p class="observation-note">Sources: <a href="https://www.ndbc.noaa.gov/" target="_blank" rel="noopener noreferrer">NDBC</a>,
        <a href="https://ocean.cwa.gov.tw/V2/" target="_blank" rel="noopener noreferrer">Taiwan CWA</a>,
        <a href="https://aviationweather.gov/data/api/" target="_blank" rel="noopener noreferrer">airport METARs</a>.</p>
    </section>` : nothing}
    ${station ? html`<div class="modal-scrim" @click=${(event: Event) => { if (event.target === event.currentTarget) propose({ kind: "observationClosed" }); }}>
      <section class="details observation-details" role="dialog" aria-modal="true" aria-labelledby="observation-title" tabindex="-1">
        <div class="details-head"><div><div class="eyebrow">STATION OBSERVATION · ${station.source}</div><h2 id="observation-title">${station.name}</h2></div>
          <button class="close-button" aria-label="Close station details" @click=${() => propose({ kind: "observationClosed" })}>×</button></div>
        <div class="coordinates">${station.latitude.toFixed(4)}°, ${station.longitude.toFixed(4)}°</div>
        <div class=${`observation-time ${stale ? "observation-old" : ""}`}>${stale ? "Older report · " : "Observed "}${timeLabel(station.observedAt)}</div>
        <div class="detail-grid">
          ${station.waveHeight === null ? nothing : html`<div><span>Significant wave height</span><strong>${station.waveHeight.toFixed(1)} m</strong></div>`}
          ${station.wavePeriod === null ? nothing : html`<div><span>${station.periodLabel}</span><strong>${station.wavePeriod.toFixed(1)} s</strong></div>`}
          ${station.meanPeriod === null ? nothing : html`<div><span>Mean period</span><strong>${station.meanPeriod.toFixed(1)} s</strong></div>`}
          ${station.waveFrom === null ? nothing : html`<div><span>Wave direction from</span><strong>${compassDirection(station.waveFrom)} · ${Math.round(station.waveFrom)}°</strong></div>`}
          ${station.windSpeed === null ? nothing : html`<div><span>Wind speed</span><strong>${(station.windSpeed * 3.6).toFixed(1)} km/h</strong><small>${station.windSpeed.toFixed(1)} m/s</small></div>`}
          ${station.windSpeed === null ? nothing : html`<div><span>Wind direction from</span><strong>${station.windSpeed === 0 ? "Calm" : station.variableWind ? "Variable" : station.windFrom === null ? "Unavailable" : station.source === "CWA" && station.kind === "wind" ? `${compassDirection(station.windFrom)} sector` : `${compassDirection(station.windFrom)} · ${Math.round(station.windFrom)}°`}</strong></div>`}
          ${station.gust === null ? nothing : html`<div><span>Gust</span><strong>${(station.gust * 3.6).toFixed(1)} km/h</strong></div>`}
        </div>
        ${station.waveHeight === null && station.windSpeed === null ? html`<p class="gust-note">No measured wave or wind reading in this report.</p>` : nothing}
        <p class="gust-note">${station.waveHeight !== null ? "Wave height includes wind waves and swell; it is not the breaking-wave height at a surf spot." : "Wind is measured at this station; conditions can differ at the beach."}</p>
        <div class="details-footer"><span>Measured, not forecast</span><a href=${station.sourceUrl} target="_blank" rel="noopener noreferrer">View source ↗</a></div>
      </section>
    </div>` : nothing}`;
};

import { html, nothing, type TemplateResult } from "lit-html";
import { observationDirection as compassDirection } from "./observations.ts";
import { observationQuery, type ObservationProposal, type ObservationsState } from "./observations-model.ts";
import { displayDateTime } from "./dates.ts";

const timeLabel = (instant: string): string => displayDateTime(new Date(instant));
export const observationsView = (state: ObservationsState, propose: (proposal: ObservationProposal) => void, now: number): TemplateResult => {
  const station = state.data?.stations.find((item) => item.id === state.selectedId);
  const active = state.wind;
  const stale = station?.observedAt && now - Date.parse(station.observedAt) > 3 * 3600_000;
  return html`
    ${state.open ? html`<section class="observations-panel saved-spots-panel" aria-label="Observation layers">
      <div class="saved-spots-head"><strong>Observations</strong><button aria-label="Close observations" @click=${() => propose({ kind: "observationsToggled" })}>×</button></div>
      <p>Measured wind conditions.</p>
      <label><input type="checkbox" .checked=${state.wind} @change=${() => propose({ kind: "observationLayerToggled", layer: "wind" })} /> <span class="observation-key wind-key">↑</span> Wind stations</label>
      ${state.wind ? html`<label class="coastal-wind-filter"><input type="checkbox" .checked=${state.taiwanCoastalWind}
        @change=${() => propose({ kind: "taiwanCoastalWindToggled" })} /> Taiwan coastal wind only</label>
        <p class="observation-note coastal-wind-note">Within roughly 5 km of the shoreline. Uncheck to include inland Taiwan stations.</p>` : nothing}
      <div class="observation-status" role="status">${!active ? "Choose a layer, then zoom into an area."
        : !observationQuery(state) ? "Zoom closer to see stations (zoom 5+)."
        : state.phase === "loading" || state.phase === "needsData" ? "Loading station observations…"
        : state.error || `${state.data?.stations.length ?? 0} stations in this view.`}</div>
      ${state.data?.issues.map((issue) => html`<p class="observation-warning">${issue.source}: ${issue.message}</p>`)}
      ${observationQuery(state) ? html`<button class="observations-refresh" ?disabled=${state.phase === "loading"} @click=${() => propose({ kind: "observationsRefreshed" })}>Refresh readings</button>` : nothing}
      <p class="observation-note">Independent of the forecast slider. Grey markers have reports over 3 hours old.</p>
      <p class="observation-note">Sources: <a href="https://www.ndbc.noaa.gov/" target="_blank" rel="noopener noreferrer">NDBC</a>,
        <a href="https://ocean.cwa.gov.tw/V2/" target="_blank" rel="noopener noreferrer">Taiwan CWA</a>,
        <a href="https://aviationweather.gov/data/api/" target="_blank" rel="noopener noreferrer">airport METARs</a>.</p>
    </section>` : nothing}
    ${station ? html`<div class="modal-scrim" @click=${(event: Event) => { if (event.target === event.currentTarget) propose({ kind: "observationClosed" }); }}>
      <section class="details observation-details" role="dialog" aria-modal="true" aria-labelledby="observation-title" tabindex="-1">
        <div class="details-head"><div><div class="eyebrow">STATION OBSERVATION · ${station.source}</div><h2 id="observation-title">${station.name}</h2></div>
          <button class="close-button" aria-label="Close station details" @click=${() => propose({ kind: "observationClosed" })}>×</button></div>
        <div class="coordinates">${station.latitude.toFixed(4)}°, ${station.longitude.toFixed(4)}°</div>
        <div class=${`observation-time ${stale ? "observation-old" : ""}`}>${station.observedAt ? html`${stale ? "Older report · " : "Observed "}${timeLabel(station.observedAt)}` : "Archive station · no current report available"}</div>
        <div class="detail-grid">
          ${station.windSpeed === null ? nothing : html`<div><span>Wind speed</span><strong>${(station.windSpeed * 3.6).toFixed(1)} km/h</strong><small>${station.windSpeed.toFixed(1)} m/s</small></div>`}
          ${station.windSpeed === null ? nothing : html`<div><span>Wind direction from</span><strong>${station.windSpeed === 0 ? "Calm" : station.variableWind ? "Variable" : station.windFrom === null ? "Unavailable" : station.source === "CWA" && station.kind === "wind" ? `${compassDirection(station.windFrom)} sector` : `${compassDirection(station.windFrom)} · ${Math.round(station.windFrom)}°`}</strong></div>`}
          ${station.gust === null ? nothing : html`<div><span>Gust</span><strong>${(station.gust * 3.6).toFixed(1)} km/h</strong></div>`}
        </div>
        ${station.windSpeed === null ? html`<p class="gust-note">No measured wind reading in this report.</p>` : nothing}
        <p class="gust-note">Wind is measured at this station; conditions can differ at the beach.</p>
        <div class="details-footer"><span>Measured, not forecast</span><a href=${station.sourceUrl} target="_blank" rel="noopener noreferrer">View source ↗</a></div>
      </section>
    </div>` : nothing}`;
};

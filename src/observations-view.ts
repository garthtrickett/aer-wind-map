import { html, nothing, type TemplateResult } from "lit-html";
import { observationDirection as compassDirection } from "./observations.ts";
import { observationQuery, type ObservationProposal, type ObservationsState } from "./observations-model.ts";
import { buoyHistoryView } from "./buoy-history-view.ts";

const timeLabel = (instant: string): string => new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
}).format(new Date(instant));
export const observationsView = (state: ObservationsState, propose: (proposal: ObservationProposal) => void, now: number): TemplateResult => {
  const station = state.data?.stations.find((item) => item.id === state.selectedId);
  const active = state.buoys || state.wind;
  const stale = station?.observedAt && now - Date.parse(station.observedAt) > 3 * 3600_000;
  const defaultDate = new Date(now);
  defaultDate.setUTCFullYear(defaultDate.getUTCFullYear() - 1);
  return html`
    ${state.open ? html`<section class="observations-panel saved-spots-panel" aria-label="Observation layers">
      <div class="saved-spots-head"><strong>Observations</strong><button aria-label="Close observations" @click=${() => propose({ kind: "observationsToggled" })}>×</button></div>
      <p>Measured conditions and wave station archives.</p>
      <label><input type="checkbox" .checked=${state.buoys} @change=${() => propose({ kind: "observationLayerToggled", layer: "buoys" })} /> <span class="observation-key buoy-key">≈</span> Wave buoys / stations</label>
      <label><input type="checkbox" .checked=${state.wind} @change=${() => propose({ kind: "observationLayerToggled", layer: "wind" })} /> <span class="observation-key wind-key">↑</span> Wind stations</label>
      <div class="observation-status" role="status">${!active ? "Choose a layer, then zoom into an area."
        : !observationQuery(state) ? "Zoom closer to see stations (zoom 5+)."
        : state.phase === "loading" || state.phase === "needsData" ? "Loading station observations…"
        : state.error || `${state.data?.stations.length ?? 0} stations in this view.`}</div>
      ${state.data?.issues.map((issue) => html`<p class="observation-warning">${issue.source}: ${issue.message}</p>`)}
      ${observationQuery(state) ? html`<button class="observations-refresh" ?disabled=${state.phase === "loading"} @click=${() => propose({ kind: "observationsRefreshed" })}>Refresh readings</button>` : nothing}
      <p class="observation-note">Independent of the forecast slider. Grey ↶ markers open archive stations without a current report. Other grey markers have reports over 3 hours old.</p>
      <p class="observation-note">Sources: <a href="https://www.ndbc.noaa.gov/" target="_blank" rel="noopener noreferrer">NDBC</a>,
        <a href="https://ocean.cwa.gov.tw/V2/" target="_blank" rel="noopener noreferrer">Taiwan CWA</a>,
        <a href="https://nowphas.mlit.go.jp/" target="_blank" rel="noopener noreferrer">Japan NOWPHAS</a>,
        <a href="https://aviationweather.gov/data/api/" target="_blank" rel="noopener noreferrer">airport METARs</a>.</p>
    </section>` : nothing}
    ${station ? html`<div class="modal-scrim" @click=${(event: Event) => { if (event.target === event.currentTarget) propose({ kind: "observationClosed" }); }}>
      <section class=${`details observation-details ${state.history.open ? "wave-history-details" : ""}`} role="dialog" aria-modal="true" aria-labelledby="observation-title" tabindex="-1">
        <div class="details-head"><div><div class="eyebrow">STATION OBSERVATION · ${station.source}</div><h2 id="observation-title">${station.name}</h2></div>
          <button class="close-button" aria-label="Close station details" @click=${() => propose({ kind: "observationClosed" })}>×</button></div>
        <div class="coordinates">${station.latitude.toFixed(4)}°, ${station.longitude.toFixed(4)}°</div>
        ${station.historyCode ? html`<div class="buoy-history-tabs"><button aria-pressed=${!state.history.open} @click=${() => propose({ kind: "observationHistoryClosed" })}>Latest report</button>
          <button aria-pressed=${state.history.open} @click=${() => propose({ kind: "observationHistoryOpened", date: state.history.date || defaultDate.toISOString().slice(0, 10) })}>Wave history</button></div>` : nothing}
        ${state.history.open ? buoyHistoryView(state, propose, now) : html`
        <div class=${`observation-time ${stale ? "observation-old" : ""}`}>${station.observedAt ? html`${stale ? "Older report · " : "Observed "}${timeLabel(station.observedAt)}` : "Archive station · no current report available"}</div>
        <div class="detail-grid">
          ${station.waveHeight === null ? nothing : html`<div><span>Significant wave height</span><strong>${station.waveHeight.toFixed(1)} m</strong></div>`}
          ${station.wavePeriod === null ? nothing : html`<div><span>${station.periodLabel}</span><strong>${station.wavePeriod.toFixed(1)} s</strong></div>`}
          ${station.meanPeriod === null ? nothing : html`<div><span>Mean period</span><strong>${station.meanPeriod.toFixed(1)} s</strong></div>`}
          ${station.waveFrom === null ? nothing : html`<div><span>Wave direction from</span><strong>${station.source === "NOWPHAS" ? `${compassDirection(station.waveFrom)} sector` : `${compassDirection(station.waveFrom)} · ${Math.round(station.waveFrom)}°`}</strong></div>`}
          ${station.windSpeed === null ? nothing : html`<div><span>Wind speed</span><strong>${(station.windSpeed * 3.6).toFixed(1)} km/h</strong><small>${station.windSpeed.toFixed(1)} m/s</small></div>`}
          ${station.windSpeed === null ? nothing : html`<div><span>Wind direction from</span><strong>${station.windSpeed === 0 ? "Calm" : station.variableWind ? "Variable" : station.windFrom === null ? "Unavailable" : station.source === "CWA" && station.kind === "wind" ? `${compassDirection(station.windFrom)} sector` : `${compassDirection(station.windFrom)} · ${Math.round(station.windFrom)}°`}</strong></div>`}
          ${station.gust === null ? nothing : html`<div><span>Gust</span><strong>${(station.gust * 3.6).toFixed(1)} km/h</strong></div>`}
        </div>
        ${station.waveHeight === null && station.windSpeed === null ? html`<p class="gust-note">No measured wave or wind reading in this report.</p>` : nothing}
        <p class="gust-note">${station.kind === "buoy" ? "Wave height includes wind waves and swell; it is not the breaking-wave height at a surf spot." : "Wind is measured at this station; conditions can differ at the beach."}</p>
        `}
        <div class="details-footer"><span>Measured, not forecast</span><a href=${station.sourceUrl} target="_blank" rel="noopener noreferrer">View source ↗</a></div>
      </section>
    </div>` : nothing}`;
};

import { html, nothing, type TemplateResult } from "lit-html";
import { describeWeatherError } from "./ecmwf.ts";
import { compassDirection, sampleWind, validTime } from "./wind.ts";
import type { Point, Proposal, State } from "./model.ts";

const dateLabel = (date: Date): string =>
  new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(date);

const runLabel = (date: Date): string =>
  new Intl.DateTimeFormat("en", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(date);

const speedLabel = (speed: number): string => `${speed.toFixed(1)} m/s`;

export const flagView = (state: State, propose: (proposal: Proposal) => void): TemplateResult | typeof nothing => {
  if (!state.selected) return nothing;
  const sample = state.field
    ? sampleWind(state.field, state.selected.latitude, state.selected.longitude)
    : null;
  const reading = sample
    ? html`<span class="flag-speed"><strong>${sample.speed.toFixed(1)}</strong><span>m/s</span></span><span class="flag-bearing">from ${compassDirection(sample.directionFrom)}</span>`
    : html`<span class="flag-waiting">${state.phase === "failed" ? "Unavailable" : "Loading wind…"}</span>`;
  const openWithKeyboard = (event: MouseEvent): void => {
    if (event.detail === 0) propose({ kind: "detailsOpened" });
  };

  return html`
    <div class="flag-stem" aria-hidden="true"></div>
    <button class="flag-point" type="button" data-flag-drag aria-label="Drag selected wind point" @click=${openWithKeyboard}></button>
    <div class="flag-panel">
      <button class="flag-grab" type="button" data-flag-drag aria-label="Drag wind flag or open details" @click=${openWithKeyboard}>
        <span class="flag-caption">Wind <span aria-hidden="true">≋</span></span>
        <span class="flag-reading">${reading}</span>
      </button>
      <button class="flag-expand" type="button" aria-label="Open wind details" @click=${() => propose({ kind: "detailsOpened" })}>⌄</button>
      <button class="flag-dismiss" type="button" aria-label="Remove wind flag" @click=${() => propose({ kind: "selectionCleared" })}>×</button>
    </div>
  `;
};

export const view = (state: State, propose: (proposal: Proposal) => void, center: () => Point): TemplateResult => {
  const forecastTime = state.run ? dateLabel(validTime({ run: state.run, step: state.step })) : "Finding forecast";
  const sample = state.field && state.selected
    ? sampleWind(state.field, state.selected.latitude, state.selected.longitude)
    : null;
  const busy = state.phase === "idle" || state.phase === "discovering" || state.phase === "needsField" || state.phase === "loading";
  const status = state.phase === "failed"
    ? "Forecast unavailable"
    : busy ? "Loading forecast" : "Live forecast";

  return html`
    <header class="masthead">
      <div class="identity">
        <span class="logo" aria-hidden="true">A</span>
        <div>
          <div class="eyebrow">GLOBAL WIND ATLAS</div>
          <h1>Aer</h1>
        </div>
      </div>
      <div class="masthead-meta">
        <div class="status-line"><span class=${`status-dot ${busy ? "busy" : state.phase === "failed" ? "failed" : ""}`}></span>${status}</div>
        <div class="model-line">ECMWF IFS · 10 m wind</div>
      </div>
    </header>

    ${state.phase === "failed" ? html`
      <div class="error-card" role="alert">
        <strong>Weather data is taking a moment.</strong>
        <p>${state.error ? describeWeatherError(state.error) : "Please try again."}</p>
        <button class="secondary-button" @click=${() => propose({ kind: "retry" })}>Try again</button>
      </div>` : nothing}

    ${state.selected ? nothing : html`<div class="map-hint">Click anywhere to inspect the wind</div>`}

    <section class="legend" aria-label="Wind speed legend">
      <div class="legend-heading"><span>WIND SPEED</span><span>m/s</span></div>
      <div class="legend-ramp" aria-hidden="true"></div>
      <div class="legend-labels"><span>0</span><span>5</span><span>10</span><span>20</span><span>35+</span></div>
    </section>

    <section class="timeline" aria-label="Forecast time">
      <div class="timeline-top">
        <div>
          <div class="eyebrow">FORECAST TIME</div>
          <div class="forecast-time">${forecastTime}</div>
        </div>
        <div class="timeline-actions">
          <button class="icon-button" aria-label=${state.playing ? "Pause forecast" : "Play forecast"} ?disabled=${!state.run} @click=${() => propose({ kind: "playToggled" })}>${state.playing ? "Ⅱ" : "▶"}</button>
          <button class="icon-button" aria-label="Inspect map center" @click=${() => propose({ kind: "locationSelected", point: center() })}>◎</button>
        </div>
      </div>
      <div class="time-control">
        <button class="step-button" aria-label="Previous forecast time" ?disabled=${!state.run || state.step <= 3} @click=${() => propose({ kind: "timeSelected", step: state.step - 3 })}>−</button>
        <input type="range" min="3" max="72" step="3" .value=${String(state.step)} ?disabled=${!state.run} aria-label="Forecast hour" @change=${(event: Event) => propose({ kind: "timeSelected", step: Number((event.target as HTMLInputElement).value) })} />
        <button class="step-button" aria-label="Next forecast time" ?disabled=${!state.run || state.step >= 72} @click=${() => propose({ kind: "timeSelected", step: state.step + 3 })}>+</button>
      </div>
      <div class="timeline-foot"><span>+3h</span><span>Run ${state.run ? runLabel(new Date(state.run.startedAt)) : "—"}</span><span>+72h</span></div>
    </section>

    ${state.modalOpen && state.selected ? html`
      <div class="modal-scrim" @click=${(event: Event) => { if (event.target === event.currentTarget) propose({ kind: "modalClosed" }); }}>
        <section class="details" role="dialog" aria-modal="true" aria-labelledby="details-title" tabindex="-1">
          <div class="details-head">
            <div>
              <div class="eyebrow">POINT FORECAST</div>
              <h2 id="details-title">Wind at this location</h2>
            </div>
            <button class="close-button" aria-label="Close details" @click=${() => propose({ kind: "modalClosed" })}>×</button>
          </div>
          <div class="coordinates">${Math.abs(state.selected.latitude).toFixed(2)}°${state.selected.latitude >= 0 ? "N" : "S"} · ${Math.abs(state.selected.longitude).toFixed(2)}°${state.selected.longitude >= 0 ? "E" : "W"}</div>
          ${sample ? html`
            <div class="primary-reading"><strong>${sample.speed.toFixed(1)}</strong><span>m/s<br />10 m wind</span></div>
            <div class="detail-grid">
              <div><span>Direction from</span><strong>${compassDirection(sample.directionFrom)} · ${Math.round(sample.directionFrom)}°</strong></div>
              <div><span>Maximum gust</span><strong>${sample.gust === null ? "Unavailable" : speedLabel(sample.gust)}</strong></div>
            </div>
            <p class="gust-note">Gust is the maximum since the previous forecast output.</p>
          ` : html`<p class="modal-loading">${busy ? "Loading wind at this time…" : "Wind data is unavailable here."}</p>`}
          <div class="details-footer"><span>Valid ${forecastTime}</span><span>ECMWF IFS</span></div>
        </section>
      </div>` : nothing}
  `;
};

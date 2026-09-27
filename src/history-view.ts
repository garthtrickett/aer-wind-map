import { html, nothing, type TemplateResult } from "lit-html";
import { summarizeHistory, type HistoryCriteria } from "./history.ts";
import { compassDirection } from "./wind.ts";
import { lastCompleteHistoryYear, type HistoryPanel, type Proposal } from "./model.ts";

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(Date.UTC(2024, month, 1))));

const coordinates = (latitude: number, longitude: number): string =>
  `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? "N" : "S"} · ${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? "E" : "W"}`;

const numberValue = (event: Event): number => Number((event.target as HTMLInputElement).value);

const numberControl = (
  label: string, value: number, min: number, max: number, step: number,
  update: (value: number) => void, unit: string,
): TemplateResult => html`
  <label class="history-control"><span>${label}</span><span class="history-input-wrap">
    <input type="number" min=${String(min)} max=${String(max)} step=${String(step)} .value=${String(value)}
      @change=${(event: Event) => {
        const next = numberValue(event);
        update(Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : value);
      }} />
    <small>${unit}</small>
  </span></label>`;

export const historyView = (history: HistoryPanel, propose: (proposal: Proposal) => void): TemplateResult | typeof nothing => {
  if (!history.open || !history.point) return nothing;
  const setCriteria = (criteria: HistoryCriteria): void => propose({ kind: "historyCriteriaChanged", criteria });
  const criteria = history.criteria;
  const summary = history.phase === "ready" && history.data ? summarizeHistory(history.data, criteria) : null;
  const ranked = summary?.months.filter((month) => month.qualifyingDays > 0)
    .sort((a, b) => b.percent - a.percent || b.qualifyingDays - a.qualifyingDays || a.month - b.month) ?? [];
  const best = ranked[0] ?? null;
  const selectedMonth = history.selectedMonth ?? best?.month ?? null;
  const selectedDays = summary?.days.filter((day) => day.month === selectedMonth && day.qualifies) ?? [];
  const localClock = history.data ? new Intl.DateTimeFormat("en", {
    timeZone: history.data.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }) : null;
  const startOptions = Array.from({ length: lastCompleteHistoryYear - 2021 }, (_, index) => 2022 + index)
    .filter((year) => year <= history.endYear && history.endYear - year <= 4);
  const endOptions = Array.from({ length: lastCompleteHistoryYear - 2021 }, (_, index) => 2022 + index)
    .filter((year) => year >= history.startYear && year - history.startYear <= 4);

  return html`
    <div class="modal-scrim history-scrim" @click=${(event: Event) => { if (event.target === event.currentTarget) propose({ kind: "historyClosed" }); }}>
      <section class="history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title" tabindex="-1">
        <div class="history-head">
          <div><div class="eyebrow">SPOT HISTORY</div><h2 id="history-title">Find your season</h2>
            <p>${coordinates(history.point.latitude, history.point.longitude)} · ${history.startYear}–${history.endYear}</p></div>
          <button class="close-button" aria-label="Close history" @click=${() => propose({ kind: "historyClosed" })}>×</button>
        </div>
        <div class="history-body">
          <div class="history-intro">A day qualifies when the swell and wind meet every rule for at least
            ${criteria.minConsecutiveHours} consecutive hourly samples. Months rank by the share of days with usable data that qualify.</div>
          <div class="history-settings">
            <div class="history-settings-head"><h3>Your conditions</h3><span>Wind and swell directions are where they come from</span></div>
            <div class="history-controls">
              ${numberControl("Swell height from", criteria.minSwellHeight, 0, 15, .1,
                (value) => setCriteria({ ...criteria, minSwellHeight: value,
                  maxSwellHeight: Math.max(value, criteria.maxSwellHeight) }), "m")}
              ${numberControl("Swell height to", criteria.maxSwellHeight, 0, 15, .1,
                (value) => setCriteria({ ...criteria, maxSwellHeight: value,
                  minSwellHeight: Math.min(value, criteria.minSwellHeight) }), "m")}
              ${numberControl("Swell period at least", criteria.minSwellPeriod, 0, 30, .5,
                (value) => setCriteria({ ...criteria, minSwellPeriod: value }), "s")}
              ${numberControl("Wind speed at most", criteria.maxWindSpeed, 0, 40, .5,
                (value) => setCriteria({ ...criteria, maxWindSpeed: value }), "m/s")}
              <label class="history-control"><span>Wind from</span><select
                  @change=${(event: Event) => setCriteria({ ...criteria, windFrom: numberValue(event) })}>
                ${Array.from({ length: 8 }, (_, index) => html`<option value=${String(index * 45)} ?selected=${criteria.windFrom === index * 45}>${compassDirection(index * 45)} · ${index * 45}°</option>`)}
              </select></label>
              ${numberControl("Direction within", criteria.windTolerance, 0, 180, 5,
                (value) => setCriteria({ ...criteria, windTolerance: value }), "°")}
              ${numberControl("Minimum window", criteria.minConsecutiveHours, 1, 12, 1,
                (value) => setCriteria({ ...criteria, minConsecutiveHours: value }), "hours")}
            </div>
            <div class="history-years">
              <label>From year <select
                @change=${(event: Event) => propose({ kind: "historyYearsChanged", startYear: numberValue(event), endYear: history.endYear })}>
                ${startOptions.map((year) => html`<option value=${String(year)} ?selected=${history.startYear === year}>${year}</option>`)}
              </select></label>
              <label>To year <select
                @change=${(event: Event) => propose({ kind: "historyYearsChanged", startYear: history.startYear, endYear: numberValue(event) })}>
                ${endOptions.map((year) => html`<option value=${String(year)} ?selected=${history.endYear === year}>${year}</option>`)}
              </select></label>
              <span>Up to five complete years</span>
            </div>
          </div>
          ${history.phase === "loading" || history.phase === "needsData" ? html`
            <div class="history-message" role="status">Loading hourly swell and wind history for ${history.startYear}–${history.endYear}…</div>`
            : history.phase === "failed" ? html`
              <div class="history-message" role="alert"><strong>Historical data could not be loaded.</strong>
                <p>${history.error?.kind === "invalid" ? "The archive returned incomplete data." : "Please check your connection and try again."}</p>
                <button class="secondary-button" @click=${() => propose({ kind: "historyRetry" })}>Try again</button></div>`
              : summary && history.data ? html`
                ${best ? html`<div class="history-best"><span>BEST MONTH FOR THESE CONDITIONS</span>
                  <strong>${monthNames[best.month]}</strong>
                  <span>${best.qualifyingDays} of ${best.observedDays} usable days · ${best.percent.toFixed(0)}%</span></div>`
                  : html`<div class="history-message">${summary.months.some((month) => month.observedDays > 0)
                    ? "No days match these conditions. Try another wind direction or adjust the swell and wind limits."
                    : "No paired swell and wind days are available for this spot and year range."}</div>`}
                <div class="history-months" aria-label="Qualifying days by month">
                  ${summary.months.map((month) => html`
                    <button type="button" class=${`history-month ${selectedMonth === month.month ? "selected" : ""}`}
                      aria-pressed=${selectedMonth === month.month}
                      aria-label=${`Show ${monthNames[month.month]} qualifying days`}
                      @click=${() => propose({ kind: "historyMonthSelected", month: month.month })}>
                      <span class="history-month-name">${monthNames[month.month].slice(0, 3)}</span>
                      <strong>${month.observedDays ? `${month.percent.toFixed(0)}%` : "—"}</strong>
                      <span class="history-bar"><span style=${`width:${month.percent}%`}></span></span>
                      <small>${month.qualifyingDays}/${month.observedDays} days</small>
                    </button>`)}
                </div>
                ${selectedMonth === null ? nothing : html`
                  <div class="history-days-head"><h3>${monthNames[selectedMonth]} windows</h3>
                    <span>${selectedDays.length} qualifying days across ${history.startYear}–${history.endYear}</span></div>
                  <div class="history-days">${selectedDays.length ? selectedDays.map((day) => html`
                    <div class="history-day"><span>${day.day}</span><strong>${day.longestWindow} hourly samples</strong>
                      <span>from ${day.windowStart === null || !localClock ? "—" : localClock.format(new Date(day.windowStart * 1000))}</span></div>`)
                    : html`<p>No qualifying days in this month.</p>`}</div>`}
                <p class="history-coverage">A usable day has at least 18 hours with both swell and wind data.
                  Times are local to ${history.data.timezone}. Wave model cell: ${coordinates(history.data.waveGrid.latitude, history.data.waveGrid.longitude)};
                  wind model cell: ${coordinates(history.data.windGrid.latitude, history.data.windGrid.longitude)}.</p>
                <button class="history-download" type="button" @click=${() => propose({ kind: "historyDownloadRequested" })}>Download hourly CSV</button>
              ` : nothing}
          <p class="history-source">Historical swell: Météo-France MFWAM via <a href="https://open-meteo.com/en/docs/marine-weather-api" target="_blank" rel="noopener noreferrer">Open-Meteo Marine</a>.
            Historical wind: ECMWF IFS via <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener noreferrer">Open-Meteo Archive</a>.
            MFWAM's source runs every 3 hours; intervening hourly values are interpolated. These are model estimates for seasonal screening.</p>
        </div>
      </section>
    </div>`;
};

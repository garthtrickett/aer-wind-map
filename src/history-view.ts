import { html, nothing, type TemplateResult } from "lit-html";
import { summarizeHistory, type HistoryCriteria } from "./history.ts";
import { historyCompassView } from "./history-compass.ts";
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
  const saveSpot = (asNew: boolean): void => propose({ kind: "savedSpotSaved",
    id: asNew || !history.savedSpotId ? crypto.randomUUID() : history.savedSpotId });
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
            ${criteria.minConsecutiveHours} consecutive hourly samples between 06:00 and 18:00 at the spot's local time.
            The same local hours apply every day.
            Months rank by the share of days with usable data that qualify.</div>
          <div class="history-settings">
            <div class="history-settings-head"><h3>Your conditions</h3><span>Directions describe where wind and swell come from</span></div>
            <div class="history-settings-layout">
              ${historyCompassView(criteria)}
              <div class="history-settings-fields">
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
              ${numberControl("Wind from", criteria.windFromStart, 0, 359, 1,
                (value) => setCriteria({ ...criteria, windFromStart: value }), "°")}
              ${numberControl("Wind to", criteria.windFromEnd, 0, 360, 1,
                (value) => setCriteria({ ...criteria, windFromEnd: value }), "°")}
              ${numberControl("Swell from", criteria.swellFromStart, 0, 359, 1,
                (value) => setCriteria({ ...criteria, swellFromStart: value }), "°")}
              ${numberControl("Swell to", criteria.swellFromEnd, 0, 360, 1,
                (value) => setCriteria({ ...criteria, swellFromEnd: value }), "°")}
              ${numberControl("Minimum window", criteria.minConsecutiveHours, 1, 12, 1,
                (value) => setCriteria({ ...criteria, minConsecutiveHours: value }), "hours")}
            </div>
            <p class="history-direction-note">Each “to” bearing is clockwise from its “from” bearing. For example, 315° to 45° crosses north; 0° to 360° includes every direction.</p>
              </div>
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
            <form class="history-save" @submit=${(event: Event) => { event.preventDefault(); saveSpot(false); }}>
              <label for="history-spot-name">Name this spot and season</label>
              <div class="history-save-actions">
                <input id="history-spot-name" type="text" maxlength="80" autocomplete="off"
                  placeholder="e.g. Wet season Bukit" .value=${history.saveName}
                  @input=${(event: Event) => propose({ kind: "savedSpotNameChanged", name: (event.target as HTMLInputElement).value })} />
                <button type="submit">${history.savedSpotId ? "Update saved spot" : "Save spot"}</button>
                ${history.savedSpotId ? html`<button type="button" class="history-save-new" @click=${() => saveSpot(true)}>Save as new</button>` : nothing}
              </div>
              <label class="history-alert-option"><input type="checkbox" .checked=${history.alertEnabled}
                @change=${(event: Event) => propose({ kind: "savedSpotAlertChanged", enabled: (event.target as HTMLInputElement).checked })} />
                Check the next 14 days and alert on screen when these conditions last at least
                ${Math.max(2, criteria.minConsecutiveHours)} consecutive hours</label>
              ${history.alertEnabled ? html`<label class="history-alert-days" for="history-alert-days">Alert when at least
                <input id="history-alert-days" type="number" min="1" max="14" step="1" .value=${String(history.alertMinDays)}
                  @change=${(event: Event) => {
                    const input = event.target as HTMLInputElement;
                    const parsed = Number(input.value);
                    const days = Number.isFinite(parsed) ? Math.min(14, Math.max(1, Math.round(parsed))) : history.alertMinDays;
                    input.value = String(days);
                    propose({ kind: "savedSpotAlertMinDaysChanged", days });
                  }} />
                of the next 14 days match</label>` : nothing}
              ${history.saveFeedback ? html`<p class=${`history-save-feedback ${history.saveFeedback === "saved" ? "success" : "error"}`}
                role=${history.saveFeedback === "saved" ? "status" : "alert"}>${history.saveFeedback === "saved" ? "Saved in this browser. Open it from Saved spots on the map."
                  : history.saveFeedback === "nameRequired" ? "Enter a name to save this spot."
                    : "Browser storage is unavailable. This spot was not saved."}</p>` : nothing}
            </form>
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

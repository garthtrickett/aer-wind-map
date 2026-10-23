import { html, nothing, type TemplateResult } from "lit-html";
import { summarizeHistory, type HistoryCriteria } from "./history.ts";
import { maxAlertRules, maxForecastDays, type AlertDayRule } from "./alert-rules.ts";
import { evaluateForecastRules, forecastPeriodLabel, scoreForecastAlert } from "./forecast-alerts.ts";
import { historyCompassView } from "./history-compass.ts";
import { lastCompleteHistoryYear, type HistoryPanel, type Proposal } from "./model.ts";

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(Date.UTC(2024, month, 1))));

const coordinates = (latitude: number, longitude: number): string =>
  `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? "N" : "S"} · ${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? "E" : "W"}`;

const numberValue = (event: Event): number => Number((event.target as HTMLInputElement).value);

const numberControl = (
  label: string, value: number | null, min: number, max: number, step: number,
  update: (value: number) => void, unit: string, clear?: () => void,
): TemplateResult => html`
  <label class="history-control"><span>${label}</span><span class="history-input-wrap">
    <input type="number" min=${String(min)} max=${String(max)} step=${String(step)} .value=${value === null ? "" : String(value)}
      placeholder=${clear ? "No limit" : nothing}
      @change=${(event: Event) => {
        if ((event.target as HTMLInputElement).value === "" && clear) { clear(); return; }
        const next = numberValue(event);
        if (Number.isFinite(next)) update(Math.min(max, Math.max(min, next)));
      }} />
    <small>${unit}</small>
  </span></label>`;

const forecastPreviewView = (history: HistoryPanel, propose: (proposal: Proposal) => void): TemplateResult => {
  const preview = history.forecastPreview;
  const refresh = (): void => propose({ kind: "forecastPreviewRefresh" });
  if (preview.phase === "idle" || preview.phase === "loading") return html`
    <div class="history-forecast-preview" aria-busy="true"><p role="status">Checking the next ${history.alertLookAheadDays} days…</p></div>`;
  if (preview.phase === "failed") return html`
    <div class="history-forecast-preview"><p role="status">The forecast could not be loaded. Try again.</p>
      <button type="button" class="secondary-button" @click=${refresh}>Retry forecast</button></div>`;
  // Draft edits rescore the downloaded hours immediately, without saving or refetching.
  const summary = scoreForecastAlert(history, preview.data.wave, preview.data.wind, new Date(preview.checkedAt));
  if (!summary) return html`
    <div class="history-forecast-preview"><p role="status">No usable paired swell and wind forecast is available for this spot.</p>
      <button type="button" class="secondary-button" @click=${refresh}>Retry forecast</button></div>`;
  const evaluation = evaluateForecastRules(summary, history.alertRules);
  const date = new Intl.DateTimeFormat("en", { timeZone: summary.timezone, weekday: "short", day: "numeric", month: "short" });
  const clock = new Intl.DateTimeFormat("en", { timeZone: summary.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return html`<div class="history-forecast-preview">
    <div class="history-forecast-heading">
      <p role="status"><strong>${summary.matchingDays} of ${summary.horizonDays} days match</strong><br />
        ${evaluation.matched ? "Your alert threshold is met." : "Your alert threshold is not met yet."}</p>
      <button type="button" class="secondary-button" @click=${refresh}>Refresh forecast</button>
    </div>
    <ul class="history-forecast-rules" aria-label="Forecast rule results">
      ${evaluation.rules.map((rule, index) => html`<li class=${rule.met ? "met" : "unmet"}>
        <span>Rule ${index + 1}: ${rule.matchingDays} matching days in a ${rule.withinDays}-day period (need ${rule.minDays})</span>
        <strong>${rule.met ? "Met" : "Not met"}</strong>
        ${rule.bestPeriod ? html`<small>${rule.met ? "Matching period" : "Best period"}: ${forecastPeriodLabel(rule.bestPeriod)}</small>`
          : html`<small>A ${rule.withinDays}-day period does not fit inside this ${summary.horizonDays}-day look-ahead.</small>`}
        ${rule.matchingPeriods.length > 1 ? html`<details><summary>All ${rule.matchingPeriods.length} qualifying periods</summary>
          <ul>${rule.matchingPeriods.map((period) => html`<li>${forecastPeriodLabel(period)} · ${period.matchingDays} matching days</li>`)}</ul>
        </details>` : nothing}
        ${rule.availableDays !== null && rule.availableDays < rule.withinDays
          ? html`<small>Usable forecast for ${rule.availableDays}/${rule.withinDays} days; the rest are unknown.</small>` : nothing}
      </li>`)}
    </ul>
    ${summary.windows.length ? html`<p class="history-forecast-caption">All matching days in the next ${summary.horizonDays} days</p><ul class="history-forecast-windows" aria-label="Matching forecast days">
      ${summary.windows.map((window) => html`<li>
        <span>${date.format(new Date(window.start * 1000))}</span>
        <strong>${clock.format(new Date(window.start * 1000))}–${clock.format(new Date(window.end * 1000))}</strong>
      </li>`)}
    </ul>` : html`<p>No days match your current conditions.</p>`}
    ${summary.availableDays < summary.horizonDays ? html`<p>Usable forecast for ${summary.availableDays} of ${summary.horizonDays} days. The remaining days are unknown.</p>` : nothing}
    <small>Times are local to the spot (${summary.timezone}). Swell: GFS Wave · Wind: ECMWF.
      Checked ${clock.format(new Date(summary.checkedAt))}.</small>
  </div>`;
};

const alertRulesView = (rules: readonly AlertDayRule[], propose: (proposal: Proposal) => void): TemplateResult => {
  const change = (next: readonly AlertDayRule[]): void => propose({ kind: "savedSpotAlertRulesChanged", rules: next });
  const update = (index: number, field: "minDays" | "withinDays", event: Event): void => {
    const input = event.target as HTMLInputElement;
    const parsed = Number(input.value);
    const value = Number.isFinite(parsed) ? Math.max(1, Math.min(14, Math.round(parsed))) : rules[index][field];
    const rule = field === "minDays" ? { ...rules[index], minDays: Math.min(value, rules[index].withinDays) }
      : { minDays: Math.min(rules[index].minDays, value), withinDays: value };
    input.value = String(rule[field]);
    change(rules.map((previous, at) => at === index ? rule : previous));
  };
  return html`<fieldset class="history-alert-rules"><legend>Alert when any rule matches</legend>
    ${rules.map((rule, index) => html`<div class="history-alert-rule">
      <span>At least</span><input type="number" min="1" max=${String(rule.withinDays)} step="1"
        aria-label=${`Matching days for rule ${index + 1}`} .value=${String(rule.minDays)}
        @change=${(event: Event) => update(index, "minDays", event)} />
      <span>matching days in any</span><input type="number" min="1" max="14" step="1"
        aria-label=${`Total days for rule ${index + 1}`} .value=${String(rule.withinDays)}
        @change=${(event: Event) => update(index, "withinDays", event)} />
      <span>day period</span><button type="button" class="history-alert-rule-remove" aria-label=${`Remove alert rule ${index + 1}`}
        ?disabled=${rules.length === 1} @click=${() => change(rules.filter((_, at) => at !== index))}>×</button>
    </div>`)}
    <button type="button" class="secondary-button" ?disabled=${rules.length >= maxAlertRules}
      @click=${() => change([...rules, { minDays: 2, withinDays: 4 }])}>Add rule</button>
    <p>Searches every complete period within the look-ahead. Any rule can trigger; matching days need the consecutive hours above.</p>
  </fieldset>`;
};

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
                (value) => setCriteria({ ...criteria, minSwellPeriod: value,
                  maxSwellPeriod: criteria.maxSwellPeriod === null ? null : Math.max(value, criteria.maxSwellPeriod) }), "s")}
              ${numberControl("Swell period at most", criteria.maxSwellPeriod, 0, 30, .5,
                (value) => setCriteria({ ...criteria, maxSwellPeriod: value,
                  minSwellPeriod: Math.min(value, criteria.minSwellPeriod) }), "s",
                () => setCriteria({ ...criteria, maxSwellPeriod: null }))}
              ${numberControl("Wind speed at most", criteria.maxWindSpeed, 0, 40, .5,
                (value) => setCriteria({ ...criteria, maxWindSpeed: value }), "m/s")}
              ${numberControl("Minimum window", criteria.minConsecutiveHours, 1, 12, 1,
                (value) => setCriteria({ ...criteria, minConsecutiveHours: value }), "hours")}
              ${numberControl("Wind from", criteria.windFromStart, 0, 359, 1,
                (value) => setCriteria({ ...criteria, windFromStart: value }), "°")}
              ${numberControl("Wind to", criteria.windFromEnd, 0, 360, 1,
                (value) => setCriteria({ ...criteria, windFromEnd: value }), "°")}
              ${numberControl("Swell from", criteria.swellFromStart, 0, 359, 1,
                (value) => setCriteria({ ...criteria, swellFromStart: value }), "°")}
              ${numberControl("Swell to", criteria.swellFromEnd, 0, 360, 1,
                (value) => setCriteria({ ...criteria, swellFromEnd: value }), "°")}
            </div>
            <p class="history-direction-note">Leave “Swell period at most” blank for no upper limit.</p>
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
                Check the forecast when these conditions last at least
                ${Math.max(2, criteria.minConsecutiveHours)} consecutive hourly samples, 06:00–18:00 local.
                Connect Telegram in Saved spots for phone alerts.</label>
              ${history.alertEnabled ? html`<label class="history-alert-lookahead">Search the next
                <input type="number" min="1" max=${String(maxForecastDays)} step="1" aria-label="Forecast look-ahead days"
                  .value=${String(history.alertLookAheadDays)} @change=${(event: Event) => {
                    const input = event.target as HTMLInputElement;
                    const number = Number(input.value);
                    const days = Number.isFinite(number) ? Math.max(1, Math.min(maxForecastDays, Math.round(number))) : history.alertLookAheadDays;
                    input.value = String(days);
                    propose({ kind: "savedSpotAlertLookAheadChanged", days });
                  }} />days for a qualifying period
              </label><p class="history-alert-lookahead-help">Look-ahead starts today at the spot; up to ${maxForecastDays} forecast days are available.</p>
                ${alertRulesView(history.alertRules, propose)}
                ${forecastPreviewView(history, propose)}` : nothing}
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

import { html, nothing, type TemplateResult } from "lit-html";
import { dayHours, firstLookupDate, type DaySource } from "./day-lookup.ts";
import type { DayLookupPanel, DayLookupProposal } from "./day-lookup-model.ts";
import { compassDirection } from "./wind.ts";
import { displayDay } from "./dates.ts";
import { dateInput } from "./date-input.ts";

const reading = (value: number | null, unit: string): string => value === null ? "—" : `${value.toFixed(1)} ${unit}`;
const direction = (value: number | null): string => value === null ? "—" : `${compassDirection(value % 360)} ${Math.round(value)}°`;
const grid = (source: DaySource): string => source.grid ? `${source.grid.latitude.toFixed(4)}, ${source.grid.longitude.toFixed(4)}` : "Unavailable";
const timeLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export const dayLookupView = (panel: DayLookupPanel, propose: (proposal: DayLookupProposal) => void, now: number): TemplateResult => {
  const loading = panel.phase === "loading" || panel.phase === "needsData";
  const data = panel.data;
  const rows = data ? dayHours(data, panel.startHour, panel.endHour) : [];
  const hasValues = rows.some((row) => row.windSpeed !== null || row.swellHeight !== null || row.waveHeight !== null);
  const clock = data ? new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : null;
  return html`<section class="day-lookup">
    <button type="button" class="day-lookup-toggle" aria-expanded=${String(panel.open)} aria-controls="day-lookup-content"
      @click=${() => propose({ kind: "dayLookupToggled" })}><span>Look up a day</span><span aria-hidden="true">${panel.open ? "−" : "+"}</span></button>
    ${panel.open ? html`<div id="day-lookup-content" class="day-lookup-content">
      <p class="day-lookup-note">Historical wind, swell and combined waves at this marker. Dates and hours are local to the spot; recent days may not yet be available.</p>
      <form class="day-lookup-controls" @submit=${(event: Event) => { event.preventDefault(); propose({ kind: "dayLookupRequested" }); }}>
        <div class="day-lookup-date date-control"><span>Date</span>${dateInput({ label: "Lookup date", value: panel.date,
          min: firstLookupDate, max: new Date(now).toISOString().slice(0, 10),
          change: (date) => propose({ kind: "dayLookupDateChanged", date }) })}</div>
        <label>From<select aria-label="Lookup start hour" .value=${String(panel.startHour)} @change=${(event: Event) => {
          const start = Number((event.target as HTMLSelectElement).value);
          propose({ kind: "dayLookupHoursChanged", start, end: Math.max(panel.endHour, start + 1) });
        }}>${Array.from({ length: 24 }, (_, hour) => html`<option value=${String(hour)} ?selected=${hour === panel.startHour}>${timeLabel(hour)}</option>`)}</select></label>
        <label>Until<select aria-label="Lookup end hour" .value=${String(panel.endHour)} @change=${(event: Event) => {
          const end = Number((event.target as HTMLSelectElement).value);
          propose({ kind: "dayLookupHoursChanged", start: Math.min(panel.startHour, end - 1), end });
        }}>${Array.from({ length: 24 }, (_, index) => html`<option value=${String(index + 1)} ?selected=${index + 1 === panel.endHour}>${timeLabel(index + 1)}</option>`)}</select></label>
        <button type="submit" ?disabled=${loading}>${loading ? "Loading…" : "Load day"}</button>
      </form>
      <div role="status" aria-live="polite" class="day-lookup-status">${loading ? "Loading hourly history…"
        : panel.message ?? (data ? `${displayDay(data.date)} · ${data.timezone} · ${rows.length} hourly records · ${timeLabel(panel.startHour)}–${timeLabel(panel.endHour)} (end excluded)` : "Choose a date and load its hourly history.")}</div>
      ${data ? html`
        ${data.wind.issue ? html`<p class="day-lookup-warning">Wind: ${data.wind.issue}</p>` : nothing}
        ${data.waves.issue ? html`<p class="day-lookup-warning">Waves: ${data.waves.issue}</p>` : nothing}
        ${!hasValues ? html`<p class="day-lookup-warning">No usable values for these hours. Missing data does not mean calm wind or flat waves.</p>` : nothing}
        ${rows.length ? html`<p class="day-lookup-note">Scroll the table sideways to see all columns.</p>` : nothing}
        ${rows.length ? html`<div class="day-lookup-table" tabindex="0" role="region" aria-label="Hourly wind and wave history"><table>
          <caption>Directions show where wind and waves come from. Swell and combined waves are separate.</caption>
          <thead><tr><th scope="col">Local time</th><th scope="col">Wind</th><th scope="col">Swell</th><th scope="col">Combined waves</th></tr></thead>
          <tbody>${rows.map((row) => html`<tr><th scope="row">${clock!.format(new Date(row.time * 1000))}</th>
            <td><strong>${reading(row.windSpeed, "km/h")}</strong><span>${row.windSpeed === 0 ? "Calm" : direction(row.windDirection)}</span></td>
            <td><strong>${reading(row.swellHeight, "m")} · ${reading(row.swellPeriod, "s")}</strong><span>${direction(row.swellDirection)}</span></td>
            <td><strong>${reading(row.waveHeight, "m")} · ${reading(row.wavePeriod, "s")}</strong><span>${direction(row.waveDirection)}</span></td>
          </tr>`)}</tbody>
        </table></div>` : nothing}
        <p class="day-lookup-note">Wind: <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener noreferrer">ECMWF IFS / Open-Meteo Archive</a> · model cell ${grid(data.wind)}.<br />
          Waves: <a href="https://open-meteo.com/en/docs/marine-weather-api" target="_blank" rel="noopener noreferrer">Météo-France MFWAM / Open-Meteo Marine</a> · model cell ${grid(data.waves)}.<br />
          Model estimates, not station measurements or breaking-wave heights. MFWAM's three-hourly values are interpolated to hourly; combined waves include wind waves and swell.</p>
      ` : nothing}
    </div>` : nothing}
  </section>`;
};

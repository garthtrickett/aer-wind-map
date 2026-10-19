import { html, svg, nothing, type TemplateResult } from "lit-html";
import type { ObservationProposal, ObservationsState } from "./observations-model.ts";
import type { BuoyHistory } from "./buoy-history.ts";
import { observationDirection } from "./observations.ts";

const reading = (value: number | null, units: string): string => value === null ? "—" : `${value.toFixed(1)} ${units}`;
const chart = (data: BuoyHistory): TemplateResult => {
  const maximum = Math.max(1, ...data.readings.map((row) => row.height ?? 0));
  const offset = data.timezone === "Asia/Tokyo" ? 9 : 8;
  const midnight = Date.parse(`${data.date}T00:00:00+${String(offset).padStart(2, "0")}:00`);
  const height = (value: number): number => value / maximum * 74;
  return html`<svg class="buoy-history-chart" viewBox="0 0 440 114" role="img" aria-label=${`Measured significant wave height on ${data.date}; maximum ${maximum.toFixed(1)} metres`}>
    <text x="2" y="12">${maximum.toFixed(1)} m</text>
    <line x1="44" x2="420" y1="88" y2="88" />
    ${data.readings.map((row) => {
      const x = 44 + (Date.parse(row.time) - midnight) / 86400_000 * 376;
      return row.height === null ? svg`<path class="missing-reading" d=${`M${x - 2},86 l4,4 m-4,0 l4,-4`} />`
        : svg`<rect x=${x} y=${88 - height(row.height)} width="3" height=${Math.max(1, height(row.height))} />`;
    })}
    ${[0, 6, 12, 18, 24].map((hour) => svg`<text x=${44 + hour / 24 * 376} y="108" text-anchor="middle">${String(hour).padStart(2, "0")}:00</text>`)}
  </svg>`;
};

export const buoyHistoryView = (state: ObservationsState, propose: (proposal: ObservationProposal) => void, now: number): TemplateResult => {
  const history = state.history, data = history.data;
  const japanese = state.selectedId?.startsWith("nowphas:");
  const zone = japanese ? "Japan · JST (UTC+9)" : "Taiwan · UTC+8";
  const today = new Date(now + (japanese ? 9 : 8) * 3600_000).toISOString().slice(0, 10);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: japanese ? "Asia/Tokyo" : "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const loading = history.phase === "loading" || history.phase === "needsData";
  const usable = data?.readings.filter((row) => row.height !== null).length ?? 0;
  return html`<div class="buoy-history">
    <div class="buoy-history-controls"><label>Observation date<input aria-label="Wave observation date" type="date" min=${japanese ? "1970-01-01" : "1990-01-01"}
      max=${today} .value=${history.date} @change=${(event: Event) => propose({ kind: "observationHistoryDateChanged", date: (event.target as HTMLInputElement).value })} /></label>
      <button ?disabled=${loading} @click=${() => propose({ kind: "observationHistoryRequested" })}>${loading ? "Loading…" : "Load date"}</button></div>
    <p class="observation-note">Dates and times below are local to the station: ${zone}.</p>
    <div role="status" aria-live="polite">${loading ? html`<p>Loading measured wave history… The first request downloads an archive; nearby dates are then cached.</p>`
      : history.error ? html`<p class="observation-warning">${history.error}</p>`
      : data ? html`<p>${usable} usable wave-height readings · ${data.status} record${data.publishedThrough ? ` · archive published through ${data.publishedThrough}` : ""}</p>`
      : html`<p>Choose a date and load the station record.</p>`}</div>
    ${data && !loading ? html`
      ${usable ? chart(data) : html`<p class="history-message">No usable wave-height measurements for this date. The station may have been offline, or this period may not be published yet. Missing data does not mean flat waves.</p>`}
      ${data.readings.length ? html`<div class="buoy-history-table" tabindex="0" aria-label="Historical wave readings"><table>
        <thead><tr><th>Local time</th><th>Height</th><th>${data.periodLabel}</th><th>Mean period</th><th>From</th></tr></thead>
        <tbody>${data.readings.map((row) => html`<tr><td>${clock.format(new Date(row.time))}</td><td>${reading(row.height, "m")}</td>
          <td>${reading(row.period, "s")}</td><td>${reading(row.meanPeriod, "s")}</td>
          <td>${row.from === null ? "—" : `${observationDirection(row.from)} ${Math.round(row.from)}°`}</td></tr>`)}</tbody>
      </table></div><button class="observations-refresh" @click=${() => propose({ kind: "observationHistoryDownloadRequested" })}>Download measured-wave CSV</button>` : nothing}
      <p class="observation-note">${data.note}</p>
      <p class="observation-note">Gaps remain missing; no forecast, interpolation or nearby station is substituted. Wave height is significant combined-wave height, not surf-face height.</p>
    ` : nothing}
  </div>`;
};

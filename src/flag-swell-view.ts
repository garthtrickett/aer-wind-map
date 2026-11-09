import { html, type TemplateResult } from "lit-html";
import { compassReadingAt } from "./compass-forecast.ts";
import { defaultHistoryCriteria } from "./history.ts";
import { compassDirection, validTime } from "./wind.ts";
import type { State } from "./model.ts";

export function flagSwellView(state: State): TemplateResult {
  const forecast = state.compassForecast;
  const time = state.run ? validTime({ run: state.run, step: state.step }).getTime() / 1000 : null;
  const swell = compassReadingAt(forecast.data, time, defaultHistoryCriteria)?.swell;
  const direction = swell?.direction;
  const pending = ["needsData", "loading"].includes(forecast.phase);
  return html`<span class="flag-swell" title="Primary swell from Météo-France MFWAM via Open-Meteo, at the selected forecast time">
    <span>Primary swell · MFWAM</span>
    ${swell && swell.height !== null && swell.period !== null ? html`<strong>${swell.height.toFixed(1)} m · ${swell.period.toFixed(1)} s</strong>
      <span class="flag-swell-direction">${direction !== null && direction !== undefined ? html`<span aria-hidden="true" class="flag-direction-arrow" style=${`transform:rotate(${direction + 180}deg)`}>↑</span>
        from ${compassDirection(direction)} · ${Math.round(direction)}°` : "Direction unavailable"}</span>`
      : html`<span>${pending ? "Loading swell…" : "Swell unavailable at this time"}</span>`}
  </span>`;
}

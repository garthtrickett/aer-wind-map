import { html, nothing, type TemplateResult } from "lit-html";
import type { ForecastRange, WindowConditions } from "./forecast-window.ts";
import { compassDirection } from "./wind.ts";

const rangeLabel = (range: ForecastRange | null, unit: string): string => {
  if (!range) return "Unavailable";
  const min = range.min.toFixed(1), max = range.max.toFixed(1);
  return `${min === max ? min : `${min}–${max}`} ${unit}`;
};
const valueLabel = (value: number | null | undefined, unit: string): string => value === null || value === undefined ? "Unavailable" : `${value.toFixed(1)} ${unit}`;
const directionLabel = (value: number | null | undefined): string => value === null || value === undefined ? "Direction unavailable" : `${compassDirection(value)} ${Math.round(value)}°`;
const directionsLabel = (directions: readonly (number | null)[]): string => {
  const sectors = [...new Set(directions.filter((value): value is number => value !== null).map(compassDirection))];
  if (!sectors.length) return "Direction unavailable";
  return [...sectors, ...(directions.includes(null) ? ["partly unavailable"] : [])].join(" / ");
};

export const forecastWindowView = (points: readonly WindowConditions[], timezone: string): TemplateResult => {
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return html`
    <div class="forecast-window-conditions">
      ${points.map((point) => html`<div class="forecast-window-point">
        ${points.length > 1 ? html`<h4>${point.name}</h4>` : nothing}
        ${point.wind ? html`<p class="forecast-window-wind"><b>Wind</b><span>${rangeLabel(point.wind.speed, "km/h")} · ${point.wind.calm ? "Calm" : directionsLabel(point.wind.directions)}</span></p>` : nothing}
        ${point.swell ? html`<p class="forecast-window-swell"><b>Primary swell</b><span>${rangeLabel(point.swell.height, "m")} · ${rangeLabel(point.swell.period, "s")} · ${point.swell.height?.max === 0 ? "No swell" : directionsLabel(point.swell.directions)}</span></p>` : nothing}
      </div>`)}
    </div>
    <details class="forecast-window-hourly">
      <summary>Hourly forecast</summary>
      <p>Forecast values for this matching window, in ${timezone}. The end time is excluded.</p>
      ${points.map((point) => html`<div class="forecast-window-table" tabindex="0" role="region" aria-label=${`Hourly forecast for ${point.name}`}>
        <table>
          <caption>${point.name}</caption>
          <thead><tr><th scope="col">Time</th>${point.wind ? html`<th scope="col">Wind</th>` : nothing}${point.swell ? html`<th scope="col">Primary swell</th>` : nothing}</tr></thead>
          <tbody>${point.hours.map((hour) => html`<tr><th scope="row">${clock.format(new Date(hour.time * 1000))}</th>
            ${point.wind ? html`<td><strong>${valueLabel(hour.wind?.speedKmh, "km/h")}</strong><span>${hour.wind?.speedKmh === 0 ? "Calm" : directionLabel(hour.wind?.direction)}</span></td>` : nothing}
            ${point.swell ? html`<td><strong>${valueLabel(hour.swell?.height, "m")} · ${valueLabel(hour.swell?.period, "s")}</strong><span>${hour.swell?.height === 0 ? "No swell" : directionLabel(hour.swell?.direction)}</span></td>` : nothing}
          </tr>`)}</tbody>
        </table>
      </div>`)}
    </details>`;
};

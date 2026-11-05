import { html, nothing, type TemplateResult } from "lit-html";
import { distributionPercent as percentLabel } from "./distribution-view.ts";
import { windDirections, windSpeedBands, type WindDistribution } from "./wind-distribution.ts";

export const windDistributionView = (distribution: WindDistribution | null, month: string): TemplateResult | typeof nothing => {
  if (!distribution) return nothing;
  const { availableHours, expectedHours, calmHours, cells } = distribution;
  const common = cells.flatMap((row, direction) => row.map((count, speed) => ({ count, direction, speed })))
    .filter((cell) => cell.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  const peak = common[0]?.count ?? 0;
  return html`<section class="history-distribution wind-distribution" aria-label=${`${month} wind direction and speed distribution`}>
    <h3>${month} wind direction × speed</h3>
    ${availableHours ? html`
      <p class="distribution-note">Each cell is a percentage of all usable wind hours, 06:00–18:00 local time.
        All winds are included, regardless of your wind and swell settings.</p>
      <p class="distribution-calm"><strong>Calm (&lt;2 km/h): ${percentLabel(calmHours, availableHours)}</strong>
        · shown separately because direction matters little in calm conditions.</p>
      <table class="distribution-table">
        <caption>Wind comes from the direction shown, grouped into 45° sectors centred on each compass point.
          Speed in km/h; ranges include the lower bound and exclude the upper bound.</caption>
        <thead><tr><th scope="col">From ↓<br />km/h →</th>${windSpeedBands.map((band) => html`<th scope="col">${band.label}</th>`)}</tr></thead>
        <tbody>${windDirections.map((direction, row) => html`<tr><th scope="row">${direction}</th>
          ${cells[row].map((count, column) => html`<td
            class=${count > 0 && count === peak ? "most-common" : ""}
            style=${`--frequency:${peak ? count / peak : 0}`}
            title=${`From ${direction} at ${windSpeedBands[column].label} km/h: ${count} of ${availableHours} usable hours`}
          >${percentLabel(count, availableHours)}</td>`)}
        </tr>`)}</tbody>
      </table>
      ${common.length ? html`<div class="distribution-common"><strong>Most common combinations</strong><ol>
        ${common.map((cell) => html`<li><span>${windDirections[cell.direction]} at ${windSpeedBands[cell.speed].label} km/h</span>
          <b>${percentLabel(cell.count, availableHours)}</b></li>`)}
      </ol></div>` : html`<p class="distribution-note">All usable hours were calm.</p>`}
      <p class="distribution-note">The grid and calm percentage together account for all usable wind hours; displayed percentages are rounded.</p>
    ` : html`<p class="distribution-note">No usable wind data for this month.</p>`}
    <p class="distribution-note">${availableHours.toLocaleString("en-GB")} of ${expectedHours.toLocaleString("en-GB")} possible hourly samples available.
      Missing speeds and missing directions for non-calm winds are excluded. This is an hourly distribution;
      the cards above count qualifying days. Modelled wind at 10 m, not station measurements.</p>
  </section>`;
};

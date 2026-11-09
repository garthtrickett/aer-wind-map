import { html, nothing, type TemplateResult } from "lit-html";
import { distributionPercent as percentLabel } from "./distribution-view.ts";
import { swellHeightBands, swellPeriodBands, type SwellDistribution } from "./swell-distribution.ts";

export const swellDistributionView = (distribution: SwellDistribution | null, month: string, partition: "primary" | "secondary" = "primary"): TemplateResult | typeof nothing => {
  if (!distribution) return nothing;
  const { availableHours, expectedHours, includedHours, withGoodWind, cells } = distribution;
  const periodTotals = swellPeriodBands.map((_, column) => cells.reduce((total, row) => total + row[column], 0));
  const common = cells.flatMap((row, height) => row.map((count, period) => ({ count, height, period })))
    .filter((cell) => cell.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  const peak = common[0]?.count ?? 0;
  return html`<section class="history-distribution swell-distribution" aria-label=${`${month} swell height and period distribution`}>
    <h3>${month} swell height × period</h3>
    ${withGoodWind ? html`<p class="distribution-subtitle">with good wind</p>` : nothing}
    ${availableHours ? html`
      <p class="distribution-note">Each cell is a percentage of all usable hours, 06:00–18:00 local time.
        ${withGoodWind ? "Counts only hours passing your wind speed and direction settings, including the calm-wind allowance." : `All ${partition} swell heights, periods and directions are included.`}</p>
      <p class="distribution-scroll-hint">Scroll sideways to see all period bands.</p>
      <div class="distribution-scroll" role="region" aria-label="Swell height and period table" tabindex="0">
      <table class="distribution-table">
        <caption>${partition === "secondary" ? "Secondary" : "Primary"} swell height (m) × period (s). ${withGoodWind ? "With good wind. " : ""}Ranges include the lower bound and exclude the upper bound.
          The All heights row totals each period column across all sizes.</caption>
        <thead><tr><th scope="col">Height ↓<br />Period →</th>${swellPeriodBands.map((band) => html`<th scope="col">${band.label}</th>`)}</tr></thead>
        <tbody>${swellHeightBands.map((band, row) => html`<tr><th scope="row">${band.label}</th>
          ${cells[row].map((count, column) => html`<td
            class=${count > 0 && count === peak ? "most-common" : ""}
            style=${`--frequency:${peak ? count / peak : 0}`}
            title=${`${band.label} at ${swellPeriodBands[column].label}: ${count} of ${availableHours} usable hours`}
          >${percentLabel(count, availableHours)}</td>`)}
        </tr>`)}</tbody>
        <tfoot><tr><th scope="row">All heights</th>${periodTotals.map((count, column) => html`<td
          title=${`All heights at ${swellPeriodBands[column].label}: ${count} of ${availableHours} usable hours${withGoodWind ? " with good wind" : ""}`}
        >${percentLabel(count, availableHours)}</td>`)}</tr></tfoot>
      </table>
      </div>
      ${common.length ? html`<div class="distribution-common"><strong>Most common combinations</strong><ol>
        ${common.map((cell) => html`<li><span>${swellHeightBands[cell.height].label} at ${swellPeriodBands[cell.period].label}</span>
          <b>${percentLabel(cell.count, availableHours)}</b></li>`)}
      </ol></div>` : html`<p class="distribution-note">No hours passed your wind settings in this month.</p>`}
      ${withGoodWind ? html`<p class="distribution-note">Good wind during ${percentLabel(includedHours, availableHours)} of usable hours.
        The remaining hours fail the wind rules, so the grid can total less than 100%. All swell heights, periods and directions are included.</p>` : nothing}
    ` : html`<p class="distribution-note">No usable ${withGoodWind ? "paired swell and wind" : "swell height and period"} data for this month.</p>`}
    <p class="distribution-note">${availableHours.toLocaleString("en-GB")} of ${expectedHours.toLocaleString("en-GB")} possible hourly samples available.
      Missing data is excluded. This is an hourly distribution; the cards above count qualifying days.
      Swell limits and minimum window do not filter this grid. Modelled ${partition} swell, not breaking-wave height.</p>
  </section>`;
};

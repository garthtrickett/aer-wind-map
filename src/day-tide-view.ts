import { html, svg, nothing, type TemplateResult } from "lit-html";
import type { DayHour } from "./day-lookup.ts";

export const dayTideView = (rows: readonly DayHour[], timezone: string): TemplateResult | typeof nothing => {
  const known = rows.filter((row): row is DayHour & { seaLevel: number } => row.seaLevel !== null);
  if (!known.length) return nothing;
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const min = Math.min(...known.map((row) => row.seaLevel)), max = Math.max(...known.map((row) => row.seaLevel));
  const padding = Math.max((max - min) * .12, .1), low = min - padding, high = max + padding;
  const first = rows[0].time, duration = Math.max(3600, rows[rows.length - 1].time - first);
  const x = (time: number) => 42 + (time - first) / duration * 242;
  const y = (level: number) => 18 + (high - level) / (high - low) * 106;
  let path = "", previous: DayHour | null = null;
  for (const row of rows) {
    if (row.seaLevel === null) { previous = null; continue; }
    path += `${previous && row.time - previous.time === 3600 ? "L" : "M"}${x(row.time).toFixed(2)},${y(row.seaLevel).toFixed(2)} `;
    previous = row;
  }
  const ticks = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].map((index) => rows[index]);
  return html`<figure class="day-tide-chart">
    <figcaption><strong>Tide / sea level</strong><span>Metres relative to mean sea level · includes weather effects</span></figcaption>
    <svg viewBox="0 0 300 153" role="img" aria-label=${`Modelled tide and sea level, ${min.toFixed(2)} to ${max.toFixed(2)} metres relative to mean sea level. Times in ${timezone}.`}>
      <line x1="42" x2="284" y1="124" y2="124" class="tide-axis" />
      ${[min, ...(max !== min ? [max] : [])].map((level) => svg`<text x="35" y=${y(level) + 4} text-anchor="end">${level.toFixed(2)}</text>`)}
      ${low < 0 && high > 0 ? svg`<line x1="42" x2="284" y1=${y(0)} y2=${y(0)} class="tide-zero" />` : nothing}
      <path d=${path} class="tide-curve" />
      ${known.map((row) => svg`<circle cx=${x(row.time)} cy=${y(row.seaLevel)} r="2.5"><title>${clock.format(new Date(row.time * 1000))} · ${row.seaLevel.toFixed(2)} m relative to mean sea level</title></circle>`)}
      ${ticks.map((row) => svg`<text x=${x(row.time)} y="146" text-anchor="middle">${clock.format(new Date(row.time * 1000))}</text>`)}
    </svg>
    <p class="day-lookup-note">Local time (${timezone}). Hourly model estimates; gaps indicate missing data.
      Heights use a different zero from most local tide tables.</p>
  </figure>`;
};

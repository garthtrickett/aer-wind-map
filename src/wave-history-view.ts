import { html, nothing, type TemplateResult } from "lit-html";
import type { HistoryPanel, Proposal } from "./model.ts";
import type { WaveHistorySource, SwellPartition } from "./wave-history-types.ts";
import { conditionSource } from "./history.ts";
export function waveHistoryControls(history: HistoryPanel, propose: (proposal: Proposal) => void): TemplateResult | typeof nothing {
  if (conditionSource(history.criteria) === "wind") return nothing;
  const source = history.historyWaveSource ?? "mfwam", partition = history.historySwellPartition ?? "primary";
  const change = (next: WaveHistorySource, component: SwellPartition) => propose({ kind: "historyWaveSourceChanged", source: next, partition: component });
  const progress = history.archiveProgress;
  return html`<section class="wave-history-source" aria-label="Historical swell source">
    <div class="history-years">
      <label>Historical swell source <select aria-label="Historical swell source" .value=${source} @change=${(event: Event) => change((event.target as HTMLSelectElement).value as WaveHistorySource, partition)}>
        <option value="mfwam" ?selected=${source === "mfwam"}>MFWAM · existing history</option><option value="ecwam" ?selected=${source === "ecwam"}>ECMWF ECWAM · hourly hindcast</option>
      </select></label>
      ${source === "ecwam" ? html`<label>Swell component <select aria-label="Swell component" .value=${partition}
        @change=${(event: Event) => change(source, (event.target as HTMLSelectElement).value as SwellPartition)}>
        <option value="primary" ?selected=${partition === "primary"}>Primary swell</option><option value="secondary" ?selected=${partition === "secondary"}>Secondary swell</option>
      </select></label>` : nothing}
    </div>
    ${source === "ecwam" ? html`<p class="history-direction-note">Hourly ECMWF ECWAM CY50R1 research hindcasts, available through 2025.
      Primary and secondary swell are stored together. Period is Tm−1,0; MFWAM history uses Tm01, so the same period threshold is not directly equivalent.
      Forecast alerts and “Look up a day” still use their existing sources.</p>
      ${progress ? html`<div class="history-message" role="status">
        <strong>${progress.ready}/${progress.total} UTC months cached</strong>
        ${progress.pending ? html`<p>${progress.pending} months downloading or queued. First downloads can take 20–30 minutes per month.
          A full year or multi-year range can take many hours. You can close Aer; downloads continue on the server. Available months appear as they finish.</p>` : nothing}
        ${progress.ready < progress.total ? html`<p>Percentages use downloaded days only. Unavailable months show —. Full-year comparisons need all months.</p>` : nothing}
        ${progress.failed ? html`<p>${progress.failed} archive requests need attention. ${progress.error}</p>` : nothing}
        ${progress.missing && progress.configured ? html`<button type="button" class="secondary-button"
          @click=${() => propose({ kind: "historyArchivePrepare" })}>Prepare missing ECMWF history</button>
          <p>Sign in before preparing new downloads. Start with one year to keep the first download smaller.</p>
          <button type="button" class="secondary-button" @click=${() => propose({ kind: "accountOpened" })}>Open account</button>` : nothing}
        ${!progress.configured ? html`<p>The server archive connection is not configured yet. Cached history remains readable.</p>` : nothing}
      </div>` : nothing}` : nothing}
  </section>`;
}

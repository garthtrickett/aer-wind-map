import { html, nothing, type TemplateResult } from "lit-html";
import type { WaybackPanel, WaybackProposal } from "./wayback-model.ts";

export const waybackView = (panel: WaybackPanel, pinned: boolean, propose: (proposal: WaybackProposal) => void,
  zoomToCoast: () => void): TemplateResult => {
  const captures = panel.data?.captures ?? [];
  const index = captures.findIndex((capture) => capture.release === panel.release);
  const capture = captures[index];
  return html`<section class="imagery-history-panel" aria-label="Imagery history">
    <div class="imagery-history-head"><strong>Imagery history</strong><span>Esri Wayback</span></div>
    ${panel.zoom < 10 ? html`<p>Zoom into a coast to find local imagery dates.</p>
      <button class="imagery-action" type="button" @click=${zoomToCoast}>${pinned ? "View selected spot" : "Zoom in here"}</button>` : html`
      <p class="imagery-location">Dates at ${pinned ? "selected pin" : "map center"}${panel.point
        ? ` · ${panel.point.latitude.toFixed(4)}, ${panel.point.longitude.toFixed(4)}` : ""} · zoom ${panel.zoom}</p>
      ${panel.phase === "needsData" || panel.phase === "loading" ? html`<p role="status">Finding local captures…</p>` : nothing}
      ${panel.message ? html`<p role="status" class="imagery-message">${panel.message}</p>` : nothing}
      ${captures.length ? html`
        <label class="imagery-date-label">Capture date at point
          <select aria-label="Imagery capture date" .value=${String(panel.release)}
            @change=${(event: Event) => propose({ kind: "waybackCaptureSelected", release: Number((event.target as HTMLSelectElement).value) })}>
            ${captures.map((entry) => html`<option value=${entry.release}>${entry.captured
              ? `${entry.captured}${entry.source ? ` · ${entry.source}` : ""}` : `Unknown capture · release ${entry.released}`}</option>`)}
          </select>
        </label>
        <div class="imagery-navigation">
          <button type="button" ?disabled=${index >= captures.length - 1} @click=${() => propose({ kind: "waybackCaptureSelected", release: captures[index + 1].release })}>← Older</button>
          <span>${index + 1} / ${captures.length}</span>
          <button type="button" ?disabled=${index <= 0} @click=${() => propose({ kind: "waybackCaptureSelected", release: captures[index - 1].release })}>Newer →</button>
        </div>
        <details class="imagery-details"><summary>Source &amp; capture details</summary>
        ${capture ? html`<dl class="imagery-metadata">
          <div><dt>Captured</dt><dd>${capture.captured ?? "Unknown"}</dd></div>
          <div><dt>Archive released</dt><dd>${capture.released}</dd></div>
          <div><dt>Source</dt><dd>${[capture.provider, capture.source].filter(Boolean).join(" · ") || "Not reported"}</dd></div>
          <div><dt>Source resolution</dt><dd>${capture.resolution === null ? "Not reported" : `${Number(capture.resolution.toPrecision(3))} m/pixel`}</dd></div>
        </dl>` : nothing}
        <p class="imagery-note">Dates describe this point. Surrounding tiles may use different captures. Imagery does not follow the forecast timeline.</p>
        ${panel.data?.metadataFailures ? html`<p class="imagery-message">Some capture metadata is unavailable; those entries show release dates only.</p>` : nothing}
        <button class="imagery-action" type="button" @click=${() => propose({ kind: "waybackRetry" })}>Refresh dates</button>
        </details>
      ` : panel.phase === "ready" ? html`<p>No local captures reported at this detail level. Try a nearby point or zoom out slightly.</p>` : nothing}
      ${panel.phase === "failed" || panel.phase === "ready" && !captures.length ? html`<button class="imagery-action" type="button" @click=${() => propose({ kind: "waybackRetry" })}>Refresh dates</button>` : nothing}
    `}
  </section>`;
};

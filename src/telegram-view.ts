import { html, nothing, type TemplateResult } from "lit-html";
import type { TelegramPanel, TelegramProposal } from "./telegram-model.ts";
import { displayDateTime } from "./dates.ts";

export const telegramView = (panel: TelegramPanel, propose: (proposal: TelegramProposal) => void): TemplateResult => {
  const status = panel.status;
  const act = (action: "status" | "connect" | "sync" | "test" | "disconnect") => propose({ kind: "telegramRequested", action });
  const time = displayDateTime;
  const issues = {
    forecast: "Some forecast data could not be checked. The server will retry.",
    delivery: "A message could not be delivered. Check the bot connection.",
    uncertain: "A message may have reached Telegram, but delivery could not be confirmed. It will not be resent automatically.",
    blocked: "Telegram blocked delivery. Unblock the bot and reconnect to resume alerts.",
  };
  return html`<section class="telegram-settings" aria-label="Telegram alerts">
    <h3>Telegram alerts</h3>
    <p>Get notified when your saved conditions match, even with Aer closed.</p>
    ${!panel.loaded ? html`<p role="status">Checking connection…</p>`
      : !status.available ? html`<p>Telegram alerts are not configured on this server yet.</p>`
        : status.connected ? html`
          <p class="telegram-connected">Connected · ${status.spotCount} enabled ${status.spotCount === 1 ? "spot" : "spots"} on the server</p>
          <p>Checks run about every 6 hours. Matches use 06:00–18:00 at each spot.</p>
          ${panel.localKey !== panel.syncedKey ? html`<p class="telegram-warning">Your saved alerts need syncing. Server checks use the last synced settings.</p>` : nothing}
          <div class="telegram-actions">
            <button type="button" ?disabled=${!!panel.request} @click=${() => act("sync")}>Sync saved alerts</button>
            <button type="button" ?disabled=${!!panel.request} @click=${() => act("test")}>Send test notification</button>
            <button type="button" ?disabled=${!!panel.request} @click=${() => act("disconnect")}>Disconnect Telegram</button>
          </div>
          ${status.lastCheckedAt ? html`<small>Last forecast check: ${time(status.lastCheckedAt)}</small>` : html`<small>Waiting for the first forecast check.</small>`}
          ${status.lastSentAt ? html`<small>Last accepted by Telegram: ${time(status.lastSentAt)}</small>` : nothing}
        ` : html`
          ${panel.connectUrl ? html`<a class="telegram-connect" href=${panel.connectUrl} target="_blank" rel="noopener noreferrer">Open Telegram and press Start ↗</a>
            <p>This private connection link expires after 10 minutes. Return here after pressing Start.</p>` : nothing}
          <button type="button" ?disabled=${!!panel.request} @click=${() => act("connect")}>
            ${panel.connectUrl ? "Get a new connection link" : "Connect Telegram"}</button>
        `}
    ${panel.request ? html`<p role="status">${panel.request.action === "sync" ? "Syncing saved alerts…" : "Updating Telegram connection…"}</p>` : nothing}
    ${status.issue ? html`<p class="telegram-warning" role="status">${issues[status.issue]}</p>` : nothing}
    ${panel.message ? html`<p role="status">${panel.message}</p>` : nothing}
    ${panel.error ? html`<p class="telegram-warning" role="alert">${panel.error}</p>` : nothing}
    <button class="telegram-refresh" type="button" ?disabled=${!!panel.request} @click=${() => act("status")}>Refresh connection status</button>
  </section>`;
};

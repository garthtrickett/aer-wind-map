import { html, nothing } from "lit-html";
import type { AccountAction, AccountPanel } from "./account-types.ts";
import type { Proposal } from "./model.ts";

export const accountView = (account: AccountPanel, propose: (proposal: Proposal) => void) => {
  const act = (action: AccountAction) => propose({ kind: "accountAction", action });
  return html`<section class="account-settings" aria-label="Aer account">
    <h3>Your Aer account</h3>
    ${account.phase === "checking" ? html`<p role="status">Checking your account…</p>` : nothing}
    ${account.confirmEmail ? html`<div class="account-confirm"><p>Sign in as <strong>${account.confirmEmail}</strong>?</p>
      <button type="button" ?disabled=${account.busy} @click=${() => act({ kind: "confirmLink" })}>Continue to Aer</button></div>` : nothing}
    ${account.user ? html`
      <p class="account-email">${account.user.email}</p>
      <p role="status">${account.sync === "saving" ? "Saving your spots…" : account.sync === "saved" ? "All changes saved to your account."
        : account.sync === "error" || account.sync === "conflict" ? "Changes are kept on this device until they can be synced." : "Your spots are saved to your account."}</p>
      ${account.browserCount && !account.imported ? html`<div class="account-import">
        <p>${account.browserCount} spots are still stored in this browser. Import them once to use them on your other devices. Your browser copy will be kept.</p>
        <button type="button" ?disabled=${account.busy || account.sync === "saving" || account.sync === "conflict" || account.sync === "error"}
          @click=${() => act({ kind: "importBrowser" })}>Import this browser’s ${account.browserCount} spots</button>
      </div>` : account.imported ? html`<p>Browser spots imported ✓</p>` : nothing}
      ${account.browserInvalid ? html`<p role="alert">Browser spots could not be read. Your original data has been kept.</p>` : nothing}
      ${account.sync === "conflict" ? html`<div class="account-actions">
        <button type="button" ?disabled=${account.busy} @click=${() => act({ kind: "keepLocal" })}>Keep this device’s version</button>
        <button type="button" ?disabled=${account.busy} @click=${() => act({ kind: "useServer" })}>Use server version</button>
        <small>Choose which version to keep for this collection. The other version will be replaced.</small>
      </div>` : account.sync === "error" ? html`<div class="account-actions">
        <button type="button" ?disabled=${account.busy} @click=${() => act({ kind: "retrySync" })}>Retry saving</button>
        <button type="button" ?disabled=${account.busy || !account.emailEnabled}
          @click=${() => act({ kind: "requestLink", email: account.user!.email })}>Email a new sign-in link</button></div>` : nothing}
      <div class="account-actions"><button type="button" ?disabled=${account.busy || ["saving", "error", "conflict"].includes(account.sync)}
        @click=${() => act({ kind: "refresh" })}>Refresh saved spots</button>
        <button type="button" ?disabled=${account.busy || ["saving", "error", "conflict"].includes(account.sync)}
          @click=${() => act({ kind: "logout" })}>Sign out</button></div>
    ` : account.phase !== "checking" ? html`
      <p>Sign up or sign in with your email to keep your spots across devices. No password needed.</p>
      <form @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget as HTMLFormElement).get("email");
        if (typeof email === "string") act({ kind: "requestLink", email });
      }}><label for="account-email">Email</label>
        <input id="account-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" />
        <button type="submit" ?disabled=${account.busy || !account.emailEnabled}>Email me a sign-in link</button>
      </form>
      ${!account.emailEnabled ? html`<p>Email sign-in is not configured yet. Your browser spots are still available.</p>` : nothing}
      ${account.phase === "unavailable" ? html`<button type="button" ?disabled=${account.busy} @click=${() => act({ kind: "refresh" })}>Retry account connection</button>` : nothing}
    ` : nothing}
    ${account.message ? html`<p class="account-message" role="status">${account.message}</p>` : nothing}
    ${account.error ? html`<p class="account-error" role="alert">${account.error}</p>` : nothing}
  </section>`;
};

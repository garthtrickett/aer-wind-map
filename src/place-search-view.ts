import { html, nothing, type TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Proposal } from "./model.ts";
import type { PlaceSearch } from "./place-search-model.ts";

export const placeSearchView = (search: PlaceSearch, propose: (proposal: Proposal) => void): TemplateResult | typeof nothing => {
  if (!search.available) return nothing;
  const searching = search.phase === "loading" || search.phase === "needsData";
  return html`<section class="place-search" aria-label="Place search"
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "Escape" && search.phase !== "idle") {
        event.stopPropagation(); event.preventDefault(); propose({ kind: "placeSearchDismissed" });
      }
    }}>
    <form class="place-search-form" role="search" @submit=${(event: SubmitEvent) => {
      event.preventDefault(); propose({ kind: "placeSearchRequested" });
    }}>
      <label for="place-search-query">Find a place</label>
      <div class="place-search-inputs">
        <input id="place-search-query" type="search" autocomplete="off" enterkeyhint="search" maxlength="120"
          placeholder="Town, beach or landmark" .value=${live(search.query)} aria-controls="place-search-results"
          @input=${(event: Event) => propose({ kind: "placeSearchQueryChanged", query: (event.target as HTMLInputElement).value })} />
        <button type="submit" ?disabled=${searching}>Search</button>
      </div>
    </form>
    <div id="place-search-results" class="place-search-results" aria-busy=${searching} ?hidden=${search.phase === "idle"}>
      ${searching ? html`<p role="status">Searching places…</p>` : nothing}
      ${search.message ? html`<p role="alert">${search.message}</p>` : nothing}
      ${search.phase === "ready" ? html`
        <p role="status">${search.places.length ? "Choose a result to move the marker." : "No places found. Try adding the region or country."}</p>
        ${search.places.length ? html`<ul>${search.places.map((place, index) => html`<li>
          <button type="button" @click=${() => propose({ kind: "placeSearchResultSelected", index })}>
            <strong>${place.name}</strong><span>${place.label}</span>
          </button></li>`)}</ul>` : nothing}
      ` : nothing}
      ${search.phase !== "idle" ? html`<div class="place-search-footer">
        <small>Search © <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">MapTiler</a> ·
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></small>
        <button type="button" aria-label="Dismiss place search results" @click=${() => propose({ kind: "placeSearchDismissed" })}>Close</button>
      </div>` : nothing}
    </div>
  </section>`;
};

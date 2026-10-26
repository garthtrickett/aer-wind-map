import { validPlaceQuery, type Place, type PlaceSearchResult } from "./place-search.ts";

export type PlaceSearch = Readonly<{
  available: boolean;
  query: string;
  request: number;
  phase: "idle" | "needsData" | "loading" | "ready" | "failed";
  places: readonly Place[];
  message: string | null;
}>;
export type PlaceSearchProposal =
  | Readonly<{ kind: "placeSearchQueryChanged"; query: string }>
  | Readonly<{ kind: "placeSearchRequested" }>
  | Readonly<{ kind: "placeSearchStarted"; request: number }>
  | Readonly<{ kind: "placeSearchCompleted"; request: number; result: PlaceSearchResult }>
  | Readonly<{ kind: "placeSearchDismissed" }>
  | Readonly<{ kind: "placeSearchResultSelected"; index: number }>;
export type PlaceSearchEffect = Readonly<{ kind: "searchPlaces"; query: string; request: number }>;
export const initialPlaceSearch: PlaceSearch = { available: false, query: "", request: 0, phase: "idle", places: [], message: null };

export const dismissPlaceSearch = (search: PlaceSearch): PlaceSearch => search.phase === "idle" ? search
  : { ...search, request: search.request + 1, phase: "idle", places: [], message: null };

export const presentPlaceSearch = (search: PlaceSearch, proposal: PlaceSearchProposal): PlaceSearch => {
  switch (proposal.kind) {
    case "placeSearchQueryChanged": return { ...search, query: proposal.query.slice(0, 120), request: search.request + 1, phase: "idle", places: [], message: null };
    case "placeSearchRequested": return !search.available || search.phase === "loading" || search.phase === "needsData" ? search
      : { ...search, request: search.request + 1, places: [], phase: validPlaceQuery(search.query) ? "needsData" : "failed",
        message: validPlaceQuery(search.query) ? null : "Enter at least two characters to search." };
    case "placeSearchStarted": return search.request === proposal.request && search.phase === "needsData" ? { ...search, phase: "loading" } : search;
    case "placeSearchCompleted": return search.request !== proposal.request || search.phase !== "loading" ? search
      : proposal.result.ok ? { ...search, phase: "ready", places: proposal.result.places, message: null }
      : { ...search, phase: "failed", places: [], message: proposal.result.message };
    case "placeSearchDismissed": return dismissPlaceSearch(search);
    case "placeSearchResultSelected": return dismissPlaceSearch(search);
  }
};

export const placeSearchEffect = (search: PlaceSearch): PlaceSearchEffect | null =>
  search.available && search.phase === "needsData" ? { kind: "searchPlaces", query: search.query, request: search.request } : null;

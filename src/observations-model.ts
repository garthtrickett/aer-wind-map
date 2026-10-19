import type { ObservationBatch, ObservationBounds, ObservationQuery } from "./observations.ts";

export type ObservationsState = Readonly<{
  open: boolean; buoys: boolean; wind: boolean; zoom: number; bounds: ObservationBounds | null;
  phase: "idle" | "needsData" | "loading" | "ready" | "failed";
  key: string | null; data: ObservationBatch | null; error: string | null; selectedId: string | null;
}>;
export type ObservationProposal =
  | Readonly<{ kind: "observationsToggled" }>
  | Readonly<{ kind: "observationLayerToggled"; layer: "buoys" | "wind" }>
  | Readonly<{ kind: "observationViewportChanged"; bounds: ObservationBounds; zoom: number }>
  | Readonly<{ kind: "observationsStarted"; key: string }>
  | Readonly<{ kind: "observationsLoaded"; key: string; data: ObservationBatch }>
  | Readonly<{ kind: "observationsFailed"; key: string; message: string }>
  | Readonly<{ kind: "observationsRefreshed" }>
  | Readonly<{ kind: "observationSelected"; id: string }>
  | Readonly<{ kind: "observationClosed" }>;
export type ObservationEffect = Readonly<{ kind: "loadObservations"; query: ObservationQuery; key: string }>;
export const initialObservations: ObservationsState = {
  open: false, buoys: false, wind: false, zoom: 0, bounds: null, phase: "idle", key: null, data: null, error: null, selectedId: null,
};
export const observationQuery = (state: ObservationsState): ObservationQuery | null => {
  const bounds = state.bounds;
  if (!(state.buoys || state.wind) || state.zoom < 5 || !bounds) return null;
  const width = bounds.east >= bounds.west ? bounds.east - bounds.west : bounds.east - bounds.west + 360;
  return width > 0 && width <= 60 && bounds.north - bounds.south <= 40
    ? { bounds, buoys: state.buoys, wind: state.wind } : null;
};
const queryKey = (state: ObservationsState): string | null => {
  const query = observationQuery(state);
  return query ? JSON.stringify(query) : null;
};
const changed = (state: ObservationsState): ObservationsState => ({ ...state,
  phase: observationQuery(state) ? "needsData" : "idle", key: null,
  data: observationQuery(state) ? state.data : null, error: null, selectedId: null });

export const presentObservations = (state: ObservationsState, proposal: ObservationProposal): ObservationsState => {
  switch (proposal.kind) {
    case "observationsToggled": return { ...state, open: !state.open };
    case "observationLayerToggled": return changed({ ...state, [proposal.layer]: !state[proposal.layer] });
    case "observationViewportChanged": {
      const next = { ...state, bounds: proposal.bounds, zoom: proposal.zoom };
      return queryKey(next) === queryKey(state) ? next : changed(next);
    }
    case "observationsRefreshed": return observationQuery(state) && state.phase !== "loading" ? changed(state) : state;
    case "observationsStarted": return { ...state, phase: "loading", key: proposal.key, error: null };
    case "observationsLoaded": return proposal.key === state.key ? { ...state, phase: "ready", data: proposal.data, error: null } : state;
    case "observationsFailed": return proposal.key === state.key ? { ...state, phase: "failed", error: proposal.message } : state;
    case "observationSelected": return state.data?.stations.some((station) => station.id === proposal.id)
      ? { ...state, selectedId: proposal.id } : state;
    case "observationClosed": return { ...state, selectedId: null };
  }
};
export const observationEffect = (state: ObservationsState): ObservationEffect | null => {
  const query = observationQuery(state), key = queryKey(state);
  return query && key && state.phase === "needsData" ? { kind: "loadObservations", query, key } : null;
};

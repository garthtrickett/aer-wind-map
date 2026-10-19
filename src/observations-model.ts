import type { ObservationBatch, ObservationBounds, ObservationQuery } from "./observations.ts";
import { validHistoryDate, type BuoyHistory } from "./buoy-history.ts";

const emptyHistory = { open: false, date: "", phase: "idle" as "idle" | "needsData" | "loading" | "ready" | "failed",
  key: null as string | null, data: null as BuoyHistory | null, error: null as string | null, downloadRequested: false };

export type ObservationsState = Readonly<{
  open: boolean; buoys: boolean; wind: boolean; taiwanCoastalWind: boolean; zoom: number; bounds: ObservationBounds | null;
  phase: "idle" | "needsData" | "loading" | "ready" | "failed";
  key: string | null; data: ObservationBatch | null; error: string | null; selectedId: string | null;
  history: Readonly<typeof emptyHistory>;
}>;
export type ObservationProposal =
  | Readonly<{ kind: "observationsToggled" }>
  | Readonly<{ kind: "observationLayerToggled"; layer: "buoys" | "wind" }>
  | Readonly<{ kind: "taiwanCoastalWindToggled" }>
  | Readonly<{ kind: "observationViewportChanged"; bounds: ObservationBounds; zoom: number }>
  | Readonly<{ kind: "observationsStarted"; key: string }>
  | Readonly<{ kind: "observationsLoaded"; key: string; data: ObservationBatch }>
  | Readonly<{ kind: "observationsFailed"; key: string; message: string }>
  | Readonly<{ kind: "observationsRefreshed" }>
  | Readonly<{ kind: "observationSelected"; id: string }>
  | Readonly<{ kind: "observationClosed" }>
  | Readonly<{ kind: "observationHistoryOpened"; date: string }>
  | Readonly<{ kind: "observationHistoryClosed" }>
  | Readonly<{ kind: "observationHistoryDateChanged"; date: string }>
  | Readonly<{ kind: "observationHistoryRequested" }>
  | Readonly<{ kind: "observationHistoryStarted"; key: string }>
  | Readonly<{ kind: "observationHistoryLoaded"; key: string; data: BuoyHistory }>
  | Readonly<{ kind: "observationHistoryFailed"; key: string; message: string }>
  | Readonly<{ kind: "observationHistoryDownloadRequested" }>
  | Readonly<{ kind: "observationHistoryDownloaded" }>;
export type ObservationEffect = Readonly<{ kind: "loadObservations"; query: ObservationQuery; key: string }>
  | Readonly<{ kind: "loadBuoyHistory"; station: string; date: string; key: string }>
  | Readonly<{ kind: "downloadBuoyHistory"; data: BuoyHistory }>;
export const initialObservations: ObservationsState = {
  open: false, buoys: false, wind: false, zoom: 0, bounds: null, phase: "idle", key: null, data: null, error: null, selectedId: null,
  history: emptyHistory, taiwanCoastalWind: true,
};
export const observationQuery = (state: ObservationsState): ObservationQuery | null => {
  const bounds = state.bounds;
  if (!(state.buoys || state.wind) || state.zoom < 5 || !bounds) return null;
  const width = bounds.east >= bounds.west ? bounds.east - bounds.west : bounds.east - bounds.west + 360;
  return width > 0 && width <= 60 && bounds.north - bounds.south <= 40
    ? { bounds, buoys: state.buoys, wind: state.wind, taiwanCoastalWind: state.taiwanCoastalWind } : null;
};
const queryKey = (state: ObservationsState): string | null => {
  const query = observationQuery(state);
  return query ? JSON.stringify(query) : null;
};
const changed = (state: ObservationsState): ObservationsState => ({ ...state,
  phase: observationQuery(state) ? "needsData" : "idle", key: null,
  data: observationQuery(state) ? state.data : null, error: null, selectedId: null, history: emptyHistory });
const historyKey = (state: ObservationsState): string => `${state.selectedId}:${state.history.date}`;

export const presentObservations = (state: ObservationsState, proposal: ObservationProposal): ObservationsState => {
  switch (proposal.kind) {
    case "observationsToggled": return { ...state, open: !state.open };
    case "observationLayerToggled": return changed({ ...state, [proposal.layer]: !state[proposal.layer] });
    case "taiwanCoastalWindToggled": return changed({ ...state, taiwanCoastalWind: !state.taiwanCoastalWind, data: null });
    case "observationViewportChanged": {
      const next = { ...state, bounds: proposal.bounds, zoom: proposal.zoom };
      return queryKey(next) === queryKey(state) ? next : changed(next);
    }
    case "observationsRefreshed": return observationQuery(state) && state.phase !== "loading"
      ? { ...changed(state), selectedId: state.selectedId, history: state.history } : state;
    case "observationsStarted": return { ...state, phase: "loading", key: proposal.key, error: null };
    case "observationsLoaded": return proposal.key === state.key ? { ...state, phase: "ready", data: proposal.data, error: null } : state;
    case "observationsFailed": return proposal.key === state.key ? { ...state, phase: "failed", error: proposal.message } : state;
    case "observationSelected": return state.data?.stations.some((station) => station.id === proposal.id)
      ? { ...state, selectedId: proposal.id, history: emptyHistory } : state;
    case "observationClosed": return { ...state, selectedId: null, history: emptyHistory };
    case "observationHistoryOpened": {
      const station = state.data?.stations.find((station) => station.id === state.selectedId);
      return station?.historyCode && validHistoryDate(proposal.date)
        ? { ...state, history: { ...emptyHistory, open: true, date: proposal.date, phase: "needsData" } } : state;
    }
    case "observationHistoryClosed": return { ...state, history: emptyHistory };
    case "observationHistoryDateChanged": return validHistoryDate(proposal.date) && state.history.open
      ? { ...state, history: { ...emptyHistory, open: true, date: proposal.date } } : state;
    case "observationHistoryRequested": return state.selectedId && state.history.open && validHistoryDate(state.history.date)
      ? { ...state, history: { ...state.history, phase: "needsData", key: null, data: null, error: null } } : state;
    case "observationHistoryStarted": return { ...state, history: { ...state.history, phase: "loading", key: proposal.key } };
    case "observationHistoryLoaded": return state.history.open && proposal.key === state.history.key && proposal.key === historyKey(state)
      ? { ...state, history: { ...state.history, phase: "ready", data: proposal.data, error: null } } : state;
    case "observationHistoryFailed": return state.history.open && proposal.key === state.history.key && proposal.key === historyKey(state)
      ? { ...state, history: { ...state.history, phase: "failed", error: proposal.message } } : state;
    case "observationHistoryDownloadRequested": return { ...state, history: { ...state.history, downloadRequested: !!state.history.data } };
    case "observationHistoryDownloaded": return { ...state, history: { ...state.history, downloadRequested: false } };
  }
};
export const observationEffect = (state: ObservationsState): ObservationEffect | null => {
  if (state.history.downloadRequested && state.history.data) return { kind: "downloadBuoyHistory", data: state.history.data };
  if (state.history.open && state.history.phase === "needsData" && state.selectedId)
    return { kind: "loadBuoyHistory", station: state.selectedId, date: state.history.date, key: historyKey(state) };
  const query = observationQuery(state), key = queryKey(state);
  return query && key && state.phase === "needsData" ? { kind: "loadObservations", query, key } : null;
};

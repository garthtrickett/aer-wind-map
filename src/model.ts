import type { WeatherError } from "./ecmwf.ts";
import type { ForecastRun } from "./wind.ts";
import type { ForecastField, Layer } from "./wave.ts";
import { defaultHistoryCriteria, type HistoricalData, type HistoryCriteria, type HistoryError } from "./history.ts";
import type { SavedSpot, SavedSpotsError } from "./saved-spots.ts";
import { forecastAlertKey, type ForecastAlertCheck, type ForecastAlertError, type ForecastAlertSummary } from "./forecast-alerts.ts";
import { initialObservations, observationEffect, presentObservations, type ObservationEffect, type ObservationProposal, type ObservationsState } from "./observations-model.ts";

export type Point = Readonly<{ latitude: number; longitude: number }>;
export const lastCompleteHistoryYear = new Date().getUTCFullYear() - 1;
export type ForecastAlertStatus =
  | Readonly<{ kind: "loading"; key: string; generation: number }>
  | Readonly<{ kind: "ready"; key: string; generation: number; summary: ForecastAlertSummary }>
  | Readonly<{ kind: "failed"; key: string; generation: number; error: ForecastAlertError }>;

export type HistoryPanel = Readonly<{
  open: boolean;
  phase: "needsData" | "loading" | "ready" | "failed";
  point: Point | null;
  startYear: number;
  endYear: number;
  criteria: HistoryCriteria;
  requestedKey: string | null;
  data: HistoricalData | null;
  error: HistoryError | null;
  selectedMonth: number | null;
  downloadRequested: boolean;
  savedSpotId: string | null;
  saveName: string;
  alertEnabled: boolean;
  alertMinDays: number;
  saveFeedback: "saved" | "nameRequired" | "storageFailed" | null;
}>;

export type State = Readonly<{
  observations: ObservationsState;
  phase: "idle" | "discovering" | "needsField" | "loading" | "ready" | "failed";
  layer: Layer;
  run: ForecastRun | null;
  step: number;
  requestedKey: string | null;
  field: ForecastField | null;
  selected: Point | null;
  modalOpen: boolean;
  error: WeatherError | null;
  playing: boolean;
  history: HistoryPanel;
  savedSpots: readonly SavedSpot[];
  savedSpotsOpen: boolean;
  savedSpotsError: SavedSpotsError | null;
  forecastAlerts: Readonly<Record<string, ForecastAlertStatus>>;
  forecastAlertsDismissed: boolean;
}>;

export type Proposal =
  | ObservationProposal
  | { readonly kind: "discoverStarted" }
  | { readonly kind: "runFound"; readonly run: ForecastRun; readonly layer: Layer }
  | { readonly kind: "loadStarted"; readonly key: string }
  | { readonly kind: "fieldLoaded"; readonly key: string; readonly field: ForecastField }
  | { readonly kind: "failed"; readonly key: string | null; readonly layer: Layer; readonly error: WeatherError }
  | { readonly kind: "layerSelected"; readonly layer: Layer }
  | { readonly kind: "timeSelected"; readonly step: number }
  | { readonly kind: "locationSelected"; readonly point: Point }
  | { readonly kind: "locationDragged"; readonly point: Point }
  | { readonly kind: "detailsOpened" }
  | { readonly kind: "selectionCleared" }
  | { readonly kind: "modalClosed" }
  | { readonly kind: "playToggled" }
  | { readonly kind: "playTick" }
  | { readonly kind: "retry" }
  | { readonly kind: "historyOpened" }
  | { readonly kind: "historyClosed" }
  | { readonly kind: "historyYearsChanged"; readonly startYear: number; readonly endYear: number }
  | { readonly kind: "historyCriteriaChanged"; readonly criteria: HistoryCriteria }
  | { readonly kind: "historyMonthSelected"; readonly month: number }
  | { readonly kind: "historyLoadStarted"; readonly key: string }
  | { readonly kind: "historyLoaded"; readonly key: string; readonly data: HistoricalData }
  | { readonly kind: "historyFailed"; readonly key: string; readonly error: HistoryError }
  | { readonly kind: "historyRetry" }
  | { readonly kind: "historyDownloadRequested" }
  | { readonly kind: "historyDownloadCompleted" }
  | { readonly kind: "savedSpotsLoaded"; readonly spots: readonly SavedSpot[] }
  | { readonly kind: "savedSpotsLoadFailed"; readonly error: SavedSpotsError }
  | { readonly kind: "savedSpotsToggled" }
  | { readonly kind: "savedSpotOpened"; readonly id: string }
  | { readonly kind: "savedSpotNameChanged"; readonly name: string }
  | { readonly kind: "savedSpotAlertChanged"; readonly enabled: boolean }
  | { readonly kind: "savedSpotAlertMinDaysChanged"; readonly days: number }
  | { readonly kind: "savedSpotSaved"; readonly id: string }
  | { readonly kind: "savedSpotRemoved"; readonly id: string }
  | { readonly kind: "savedSpotsPersistFailed"; readonly error: SavedSpotsError }
  | { readonly kind: "forecastAlertsStarted"; readonly generation: number; readonly entries: readonly Readonly<{ id: string; key: string }>[] }
  | { readonly kind: "forecastAlertsCompleted"; readonly generation: number; readonly checks: readonly ForecastAlertCheck[] }
  | { readonly kind: "forecastAlertsDismissed" }
  | { readonly kind: "forecastAlertsShown" };

export const initialState: State = {
  observations: initialObservations,
  phase: "idle", layer: "wind", run: null, step: 3, requestedKey: null, field: null,
  selected: null, modalOpen: false, error: null, playing: false,
  savedSpots: [], savedSpotsOpen: false, savedSpotsError: null,
  forecastAlerts: {}, forecastAlertsDismissed: false,
  history: {
    open: false, phase: "needsData", point: null,
    startYear: Math.max(2022, lastCompleteHistoryYear - 2), endYear: lastCompleteHistoryYear,
    criteria: defaultHistoryCriteria, requestedKey: null, data: null, error: null, selectedMonth: null, downloadRequested: false,
    savedSpotId: null, saveName: "", alertEnabled: false, alertMinDays: 1, saveFeedback: null,
  },
};

export const fieldKey = (run: ForecastRun, step: number, layer: Layer = "wind"): string => `${run.id}:${layer}:${step}`;
export const historyKey = (point: Point, startYear: number, endYear: number): string =>
  `${point.latitude}:${point.longitude}:${startYear}:${endYear}`;

export const validCriteria = (criteria: HistoryCriteria): boolean =>
  Number.isFinite(criteria.minSwellHeight) && criteria.minSwellHeight >= 0 && criteria.minSwellHeight <= 15 &&
  Number.isFinite(criteria.maxSwellHeight) && criteria.maxSwellHeight >= criteria.minSwellHeight && criteria.maxSwellHeight <= 15 &&
  Number.isFinite(criteria.minSwellPeriod) && criteria.minSwellPeriod >= 0 && criteria.minSwellPeriod <= 30 &&
  Number.isFinite(criteria.maxWindSpeed) && criteria.maxWindSpeed >= 0 && criteria.maxWindSpeed <= 40 &&
  Number.isFinite(criteria.windFromStart) && criteria.windFromStart >= 0 && criteria.windFromStart < 360 &&
  Number.isFinite(criteria.windFromEnd) && criteria.windFromEnd >= 0 && criteria.windFromEnd <= 360 &&
  Number.isFinite(criteria.swellFromStart) && criteria.swellFromStart >= 0 && criteria.swellFromStart < 360 &&
  Number.isFinite(criteria.swellFromEnd) && criteria.swellFromEnd >= 0 && criteria.swellFromEnd <= 360 &&
  Number.isInteger(criteria.minConsecutiveHours) && criteria.minConsecutiveHours >= 1 && criteria.minConsecutiveHours <= 12;

const selectionChanged = (state: State, point: Point): State => ({
  ...state, selected: point, modalOpen: false,
  observations: { ...state.observations, selectedId: null },
  history: { ...state.history, open: false, point: null, phase: "needsData", requestedKey: null, data: null, error: null,
    downloadRequested: false, savedSpotId: null, saveName: "", alertEnabled: false, alertMinDays: 1, saveFeedback: null },
});

export const present = (state: State, proposal: Proposal): State => {
  switch (proposal.kind) {
    case "observationsToggled":
    case "observationLayerToggled":
    case "observationViewportChanged":
    case "observationsStarted":
    case "observationsLoaded":
    case "observationsFailed":
    case "observationsRefreshed":
    case "observationSelected":
    case "observationHistoryOpened":
    case "observationHistoryClosed":
    case "observationHistoryDateChanged":
    case "observationHistoryRequested":
    case "observationHistoryStarted":
    case "observationHistoryLoaded":
    case "observationHistoryFailed":
    case "observationHistoryDownloadRequested":
    case "observationHistoryDownloaded":
    case "observationClosed": {
      const observations = presentObservations(state.observations, proposal);
      return observations === state.observations ? state : { ...state, observations,
        ...(proposal.kind === "observationsToggled" ? { savedSpotsOpen: false } : {}),
        ...(proposal.kind === "observationSelected" && observations.selectedId ? { modalOpen: false, history: { ...state.history, open: false } } : {}),
      };
    }
    case "discoverStarted": return { ...state, phase: "discovering", error: null };
    case "runFound": return proposal.layer === state.layer ? { ...state, phase: "needsField", run: proposal.run, error: null } : state;
    case "loadStarted": return { ...state, phase: "loading", requestedKey: proposal.key, error: null };
    case "fieldLoaded":
      if (proposal.key !== state.requestedKey || proposal.key !== (state.run && fieldKey(state.run, state.step, state.layer)) || proposal.field.kind !== state.layer) return state;
      return { ...state, phase: "ready", field: proposal.field, requestedKey: null, error: null };
    case "failed":
      if (proposal.layer !== state.layer || proposal.key !== state.requestedKey) return state;
      return { ...state, phase: "failed", requestedKey: null, error: proposal.error, playing: false };
    case "layerSelected":
      if (proposal.layer === state.layer) return state;
      return { ...state, layer: proposal.layer, phase: "idle", run: null, field: null, requestedKey: null, error: null, playing: false };
    case "timeSelected":
      if (proposal.step === state.step || proposal.step < 3 || proposal.step > 72 || proposal.step % 3 !== 0) return state;
      return { ...state, phase: "needsField", step: proposal.step, field: null, requestedKey: null, error: null };
    case "locationSelected": return selectionChanged(state, proposal.point);
    case "locationDragged": return selectionChanged(state, proposal.point);
    case "detailsOpened": return state.selected ? { ...state, modalOpen: true } : state;
    case "selectionCleared": return { ...state, selected: null, modalOpen: false, history: { ...state.history, open: false, point: null, data: null, requestedKey: null, downloadRequested: false } };
    case "modalClosed": return { ...state, modalOpen: false };
    case "playToggled": return { ...state, playing: !state.playing };
    case "playTick":
      if (!state.playing || state.phase !== "ready") return state;
      return { ...state, phase: "needsField", step: state.step === 72 ? 3 : state.step + 3, field: null, requestedKey: null };
    case "retry": return { ...state, phase: state.run ? "needsField" : "idle", error: null };
    case "historyOpened":
      if (!state.selected) return state;
      return { ...state, modalOpen: false, history: {
        ...state.history, open: true, point: state.selected,
        phase: state.history.data && state.history.point?.latitude === state.selected.latitude && state.history.point.longitude === state.selected.longitude
          ? "ready" : "needsData",
        requestedKey: null, error: null,
      } };
    case "savedSpotsLoaded": return { ...state, savedSpots: proposal.spots, savedSpotsError: null };
    case "savedSpotsLoadFailed": return { ...state, savedSpotsError: proposal.error };
    case "savedSpotsToggled": return { ...state, savedSpotsOpen: !state.savedSpotsOpen, observations: { ...state.observations, open: false } };
    case "savedSpotOpened": {
      const spot = state.savedSpots.find((item) => item.id === proposal.id);
      if (!spot) return state;
      const sameData = state.history.data && state.history.point?.latitude === spot.point.latitude &&
        state.history.point.longitude === spot.point.longitude &&
        state.history.startYear === spot.startYear && state.history.endYear === spot.endYear;
      return { ...state, selected: spot.point, modalOpen: false, savedSpotsOpen: false, history: {
        ...state.history, open: true, point: spot.point, startYear: spot.startYear, endYear: spot.endYear,
        criteria: spot.criteria, phase: sameData ? "ready" : "needsData", data: sameData ? state.history.data : null,
        requestedKey: null, error: null, selectedMonth: null, downloadRequested: false,
        savedSpotId: spot.id, saveName: spot.name, alertEnabled: spot.alertEnabled, alertMinDays: spot.alertMinDays, saveFeedback: null,
      } };
    }
    case "savedSpotNameChanged":
      return state.history.open ? { ...state, history: { ...state.history, saveName: proposal.name, saveFeedback: null } } : state;
    case "savedSpotAlertChanged":
      return state.history.open ? { ...state, history: { ...state.history, alertEnabled: proposal.enabled, saveFeedback: null } } : state;
    case "savedSpotAlertMinDaysChanged":
      return state.history.open && Number.isInteger(proposal.days) && proposal.days >= 1 && proposal.days <= 14
        ? { ...state, history: { ...state.history, alertMinDays: proposal.days, saveFeedback: null } } : state;
    case "savedSpotSaved": {
      const history = state.history;
      if (!history.open || !history.point) return state;
      const name = history.saveName.trim();
      if (!name || name.length > 80) return { ...state, history: { ...history, saveFeedback: "nameRequired" } };
      const spot: SavedSpot = { id: proposal.id, name, point: history.point,
        startYear: history.startYear, endYear: history.endYear, criteria: history.criteria,
        alertEnabled: history.alertEnabled, alertMinDays: history.alertMinDays };
      const exists = state.savedSpots.some((item) => item.id === proposal.id);
      return { ...state, savedSpots: exists ? state.savedSpots.map((item) => item.id === proposal.id ? spot : item) : [spot, ...state.savedSpots],
        savedSpotsError: null, history: { ...history, savedSpotId: proposal.id, saveName: name, saveFeedback: "saved" } };
    }
    case "savedSpotRemoved": {
      const spots = state.savedSpots.filter((spot) => spot.id !== proposal.id);
      if (spots.length === state.savedSpots.length) return state;
      const alerts = { ...state.forecastAlerts };
      delete alerts[proposal.id];
      return { ...state, savedSpots: spots, savedSpotsError: null, forecastAlerts: alerts,
        history: state.history.savedSpotId === proposal.id
        ? { ...state.history, savedSpotId: null, saveFeedback: null } : state.history };
    }
    case "savedSpotsPersistFailed": return { ...state, savedSpotsError: proposal.error,
      history: { ...state.history, saveFeedback: "storageFailed" } };
    case "forecastAlertsStarted": {
      const alerts = { ...state.forecastAlerts };
      const newRules = proposal.entries.some((entry) => alerts[entry.id]?.key !== entry.key);
      for (const entry of proposal.entries) {
        const spot = state.savedSpots.find((item) => item.id === entry.id);
        if (spot?.alertEnabled && forecastAlertKey(spot) === entry.key) {
          const previous = alerts[entry.id];
          alerts[entry.id] = previous?.kind === "ready" && previous.key === entry.key
            ? { ...previous, generation: proposal.generation }
            : { kind: "loading", key: entry.key, generation: proposal.generation };
        }
      }
      return { ...state, forecastAlerts: alerts, forecastAlertsDismissed: newRules ? false : state.forecastAlertsDismissed };
    }
    case "forecastAlertsCompleted": {
      const alerts = { ...state.forecastAlerts };
      for (const check of proposal.checks) {
        const spot = state.savedSpots.find((item) => item.id === check.id);
        if (!spot?.alertEnabled || forecastAlertKey(spot) !== check.key || alerts[check.id]?.generation !== proposal.generation) continue;
        alerts[check.id] = check.ok ? { kind: "ready", key: check.key, generation: proposal.generation, summary: check.summary }
          : { kind: "failed", key: check.key, generation: proposal.generation, error: check.error };
      }
      return { ...state, forecastAlerts: alerts };
    }
    case "forecastAlertsDismissed": return { ...state, forecastAlertsDismissed: true };
    case "forecastAlertsShown": return { ...state, forecastAlertsDismissed: false };
    case "historyClosed": return { ...state, history: { ...state.history, open: false, requestedKey: null, downloadRequested: false } };
    case "historyYearsChanged":
      if (!Number.isInteger(proposal.startYear) || !Number.isInteger(proposal.endYear) ||
        proposal.startYear < 2022 || proposal.endYear > lastCompleteHistoryYear ||
        proposal.startYear > proposal.endYear || proposal.endYear - proposal.startYear > 4) return state;
      if (proposal.startYear === state.history.startYear && proposal.endYear === state.history.endYear) return state;
      return { ...state, history: { ...state.history, startYear: proposal.startYear, endYear: proposal.endYear,
        phase: "needsData", requestedKey: null, data: null, error: null, selectedMonth: null, saveFeedback: null } };
    case "historyCriteriaChanged":
      return validCriteria(proposal.criteria)
        ? { ...state, history: { ...state.history, criteria: proposal.criteria, selectedMonth: null, saveFeedback: null } } : state;
    case "historyMonthSelected":
      return proposal.month >= 0 && proposal.month < 12
        ? { ...state, history: { ...state.history, selectedMonth: proposal.month } } : state;
    case "historyLoadStarted": return { ...state, history: { ...state.history, phase: "loading", requestedKey: proposal.key, error: null } };
    case "historyLoaded":
      if (!state.history.open || proposal.key !== state.history.requestedKey || !state.history.point ||
        proposal.key !== historyKey(state.history.point, state.history.startYear, state.history.endYear)) return state;
      return { ...state, history: { ...state.history, phase: "ready", data: proposal.data, requestedKey: null, error: null } };
    case "historyFailed":
      if (!state.history.open || proposal.key !== state.history.requestedKey) return state;
      return { ...state, history: { ...state.history, phase: "failed", requestedKey: null, error: proposal.error } };
    case "historyRetry": return { ...state, history: { ...state.history, phase: "needsData", requestedKey: null, error: null } };
    case "historyDownloadRequested": return state.history.open && state.history.data
      ? { ...state, history: { ...state.history, downloadRequested: true } } : state;
    case "historyDownloadCompleted": return { ...state, history: { ...state.history, downloadRequested: false } };
  }
};

export type Effect =
  | ObservationEffect
  | { readonly kind: "discover"; readonly layer: Layer }
  | { readonly kind: "load"; readonly run: ForecastRun; readonly step: number; readonly key: string; readonly layer: Layer }
  | { readonly kind: "loadHistory"; readonly point: Point; readonly startYear: number; readonly endYear: number; readonly key: string }
  | { readonly kind: "downloadHistory"; readonly data: HistoricalData; readonly criteria: HistoryCriteria };

export const nap = (state: State): Effect | null => {
  if (state.history.downloadRequested && state.history.data) {
    return { kind: "downloadHistory", data: state.history.data, criteria: state.history.criteria };
  }
  if (state.history.open && state.history.phase === "needsData" && state.history.point) {
    return { kind: "loadHistory", point: state.history.point, startYear: state.history.startYear,
      endYear: state.history.endYear, key: historyKey(state.history.point, state.history.startYear, state.history.endYear) };
  }
  if (state.phase === "idle") return { kind: "discover", layer: state.layer };
  if (state.phase === "needsField" && state.run) {
    return { kind: "load", run: state.run, step: state.step, key: fieldKey(state.run, state.step, state.layer), layer: state.layer };
  }
  return observationEffect(state.observations);
};

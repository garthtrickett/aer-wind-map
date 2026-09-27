import type { WeatherError } from "./ecmwf.ts";
import type { ForecastRun } from "./wind.ts";
import type { ForecastField, Layer } from "./wave.ts";
import { defaultHistoryCriteria, type HistoricalData, type HistoryCriteria, type HistoryError } from "./history.ts";

export type Point = Readonly<{ latitude: number; longitude: number }>;
export const lastCompleteHistoryYear = new Date().getUTCFullYear() - 1;

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
}>;

export type State = Readonly<{
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
}>;

export type Proposal =
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
  | { readonly kind: "historyDownloadCompleted" };

export const initialState: State = {
  phase: "idle", layer: "wind", run: null, step: 3, requestedKey: null, field: null,
  selected: null, modalOpen: false, error: null, playing: false,
  history: {
    open: false, phase: "needsData", point: null,
    startYear: Math.max(2022, lastCompleteHistoryYear - 2), endYear: lastCompleteHistoryYear,
    criteria: defaultHistoryCriteria, requestedKey: null, data: null, error: null, selectedMonth: null, downloadRequested: false,
  },
};

export const fieldKey = (run: ForecastRun, step: number, layer: Layer = "wind"): string => `${run.id}:${layer}:${step}`;
export const historyKey = (point: Point, startYear: number, endYear: number): string =>
  `${point.latitude}:${point.longitude}:${startYear}:${endYear}`;

const validCriteria = (criteria: HistoryCriteria): boolean =>
  Number.isFinite(criteria.minSwellHeight) && criteria.minSwellHeight >= 0 && criteria.minSwellHeight <= 15 &&
  Number.isFinite(criteria.maxSwellHeight) && criteria.maxSwellHeight >= criteria.minSwellHeight && criteria.maxSwellHeight <= 15 &&
  Number.isFinite(criteria.minSwellPeriod) && criteria.minSwellPeriod >= 0 && criteria.minSwellPeriod <= 30 &&
  Number.isFinite(criteria.maxWindSpeed) && criteria.maxWindSpeed >= 0 && criteria.maxWindSpeed <= 40 &&
  Number.isFinite(criteria.windFrom) && criteria.windFrom >= 0 && criteria.windFrom < 360 &&
  Number.isFinite(criteria.windTolerance) && criteria.windTolerance >= 0 && criteria.windTolerance <= 180 &&
  Number.isInteger(criteria.minConsecutiveHours) && criteria.minConsecutiveHours >= 1 && criteria.minConsecutiveHours <= 12;

const selectionChanged = (state: State, point: Point): State => ({
  ...state, selected: point, modalOpen: false,
  history: { ...state.history, open: false, point: null, phase: "needsData", requestedKey: null, data: null, error: null, downloadRequested: false },
});

export const present = (state: State, proposal: Proposal): State => {
  switch (proposal.kind) {
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
    case "historyClosed": return { ...state, history: { ...state.history, open: false, requestedKey: null, downloadRequested: false } };
    case "historyYearsChanged":
      if (!Number.isInteger(proposal.startYear) || !Number.isInteger(proposal.endYear) ||
        proposal.startYear < 2022 || proposal.endYear > lastCompleteHistoryYear ||
        proposal.startYear > proposal.endYear || proposal.endYear - proposal.startYear > 4) return state;
      if (proposal.startYear === state.history.startYear && proposal.endYear === state.history.endYear) return state;
      return { ...state, history: { ...state.history, startYear: proposal.startYear, endYear: proposal.endYear,
        phase: "needsData", requestedKey: null, data: null, error: null, selectedMonth: null } };
    case "historyCriteriaChanged":
      return validCriteria(proposal.criteria)
        ? { ...state, history: { ...state.history, criteria: proposal.criteria, selectedMonth: null } } : state;
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
  return null;
};

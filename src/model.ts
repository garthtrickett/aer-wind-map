import type { WeatherError } from "./ecmwf.ts";
import type { ForecastRun, WindField } from "./wind.ts";

export type Point = Readonly<{ latitude: number; longitude: number }>;
export type State = Readonly<{
  phase: "idle" | "discovering" | "needsField" | "loading" | "ready" | "failed";
  run: ForecastRun | null;
  step: number;
  requestedKey: string | null;
  field: WindField | null;
  selected: Point | null;
  modalOpen: boolean;
  error: WeatherError | null;
  playing: boolean;
}>;

export type Proposal =
  | { readonly kind: "discoverStarted" }
  | { readonly kind: "runFound"; readonly run: ForecastRun }
  | { readonly kind: "loadStarted"; readonly key: string }
  | { readonly kind: "fieldLoaded"; readonly key: string; readonly field: WindField }
  | { readonly kind: "failed"; readonly key: string | null; readonly error: WeatherError }
  | { readonly kind: "timeSelected"; readonly step: number }
  | { readonly kind: "locationSelected"; readonly point: Point }
  | { readonly kind: "locationDragged"; readonly point: Point }
  | { readonly kind: "detailsOpened" }
  | { readonly kind: "selectionCleared" }
  | { readonly kind: "modalClosed" }
  | { readonly kind: "playToggled" }
  | { readonly kind: "playTick" }
  | { readonly kind: "retry" };

export const initialState: State = {
  phase: "idle", run: null, step: 3, requestedKey: null, field: null,
  selected: null, modalOpen: false, error: null, playing: false,
};

export const fieldKey = (run: ForecastRun, step: number): string => `${run.id}:${step}`;

export const present = (state: State, proposal: Proposal): State => {
  switch (proposal.kind) {
    case "discoverStarted": return { ...state, phase: "discovering", error: null };
    case "runFound": return { ...state, phase: "needsField", run: proposal.run, error: null };
    case "loadStarted": return { ...state, phase: "loading", requestedKey: proposal.key, error: null };
    case "fieldLoaded":
      if (proposal.key !== state.requestedKey || proposal.key !== (state.run && fieldKey(state.run, state.step))) return state;
      return { ...state, phase: "ready", field: proposal.field, requestedKey: null, error: null };
    case "failed":
      if (proposal.key !== state.requestedKey) return state;
      return { ...state, phase: "failed", requestedKey: null, error: proposal.error, playing: false };
    case "timeSelected":
      if (proposal.step === state.step || proposal.step < 3 || proposal.step > 72 || proposal.step % 3 !== 0) return state;
      return { ...state, phase: "needsField", step: proposal.step, field: null, requestedKey: null, error: null };
    case "locationSelected": return { ...state, selected: proposal.point, modalOpen: false };
    case "locationDragged": return { ...state, selected: proposal.point, modalOpen: false };
    case "detailsOpened": return state.selected ? { ...state, modalOpen: true } : state;
    case "selectionCleared": return { ...state, selected: null, modalOpen: false };
    case "modalClosed": return { ...state, modalOpen: false };
    case "playToggled": return { ...state, playing: !state.playing };
    case "playTick":
      if (!state.playing || state.phase !== "ready") return state;
      return { ...state, phase: "needsField", step: state.step === 72 ? 3 : state.step + 3, field: null, requestedKey: null };
    case "retry": return { ...state, phase: state.run ? "needsField" : "idle", error: null };
  }
};

export type Effect =
  | { readonly kind: "discover" }
  | { readonly kind: "load"; readonly run: ForecastRun; readonly step: number; readonly key: string };

export const nap = (state: State): Effect | null => {
  if (state.phase === "idle") return { kind: "discover" };
  if (state.phase === "needsField" && state.run) {
    return { kind: "load", run: state.run, step: state.step, key: fieldKey(state.run, state.step) };
  }
  return null;
};

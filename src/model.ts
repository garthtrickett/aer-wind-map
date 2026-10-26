import { initialCompassForecast, alignCompassForecast, presentCompassForecast, compassForecastEffect, type CompassForecast, type CompassForecastProposal, type CompassForecastEffect } from "./compass-forecast-model.ts";
import { alertRulesFor, forecastLookAhead, validForecastLookAhead, validAlertRules, type AlertDayRule } from "./alert-rules.ts";
import { initialTelegram, presentTelegram, type TelegramPanel, type TelegramProposal } from "./telegram-model.ts";
import type { WeatherError } from "./ecmwf.ts";
import type { ForecastRun } from "./wind.ts";
import type { ForecastField, Layer } from "./wave.ts";
import { conditionSource, type ConditionSource, validCriteria, lastCompleteHistoryYear, defaultHistoryCriteria, type HistoricalData, type HistoryCriteria, type HistoryError } from "./history.ts";
import { linkedSpotGroup, validSpotLinks } from "./spot-links.ts";
import type { SavedSpot, SavedSpotsError } from "./saved-spots.ts";
import { forecastAlertKey, type ForecastData, type ForecastDataResult, type ForecastAlertCheck, type ForecastAlertError, type ForecastAlertSummary } from "./forecast-alerts.ts";
import { initialObservations, observationEffect, presentObservations, type ObservationEffect, type ObservationProposal, type ObservationsState } from "./observations-model.ts";
import { alignDayLookup, dayLookupEffect, initialDayLookup, presentDayLookup, type DayLookupEffect, type DayLookupPanel, type DayLookupProposal } from "./day-lookup-model.ts";
import type { Basemap, SatelliteResult, Satellite } from "./satellite.ts";
import { initialWayback, alignWayback, presentWayback, waybackEffect, type WaybackPanel, type WaybackProposal, type WaybackEffect } from "./wayback-model.ts";
import { initialPlaceSearch, dismissPlaceSearch, presentPlaceSearch, placeSearchEffect, type PlaceSearch, type PlaceSearchProposal, type PlaceSearchEffect } from "./place-search-model.ts";

export type Point = Readonly<{ latitude: number; longitude: number }>;
export type ForecastAlertStatus =
  | Readonly<{ kind: "loading"; key: string; generation: number }>
  | Readonly<{ kind: "ready"; key: string; generation: number; summary: ForecastAlertSummary }>
  | Readonly<{ kind: "failed"; key: string; generation: number; error: ForecastAlertError }>;

export type ForecastPreview = { readonly request: number } & (
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "loading" }>
  | Readonly<{ phase: "ready"; data: ForecastData; checkedAt: number }>
  | Readonly<{ phase: "failed"; error: ForecastAlertError }>
);
const resetForecastPreview = (preview: ForecastPreview): ForecastPreview => ({ phase: "idle", request: preview.request + 1 });

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
  linkedSpotIds: readonly string[];
  linkedCatalog: readonly SavedSpot[];
  sourceSpotId: string | null;
  saveName: string;
  alertEnabled: boolean;
  alertRules: readonly AlertDayRule[];
  alertLookAheadDays: number;
  forecastPreview: ForecastPreview;
  saveFeedback: "saved" | "nameRequired" | "storageFailed" | null;
}>;

export type State = Readonly<{
  placeSearch: PlaceSearch;
  basemap: Basemap;
  compassForecast: CompassForecast;
  wayback: WaybackPanel;
  weatherOverlay: boolean;
  satellite: Readonly<{ available: boolean; phase: "idle" | "needsData" | "loading" | "ready" | "failed"; data: Satellite | null; message: string | null }>;
  dayLookup: DayLookupPanel;
  telegram: TelegramPanel;
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
  | PlaceSearchProposal
  | CompassForecastProposal
  | WaybackProposal
  | { readonly kind: "basemapSelected"; readonly basemap: Basemap }
  | { readonly kind: "weatherOverlayChanged"; readonly visible: boolean }
  | { readonly kind: "satelliteStarted" }
  | { readonly kind: "satelliteCompleted"; readonly result: SatelliteResult }
  | { readonly kind: "satelliteTilesFailed" }
  | DayLookupProposal
  | TelegramProposal
  | { readonly kind: "telegramSpotRestored"; readonly spot: SavedSpot; readonly linkedSpots?: readonly SavedSpot[]; readonly readOnly?: boolean }
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
  | { readonly kind: "savedSpotAlertLookAheadChanged"; readonly days: number }
  | { readonly kind: "savedSpotAlertRulesChanged"; readonly rules: readonly AlertDayRule[] }
  | { readonly kind: "savedSpotLinksChanged"; readonly ids: readonly string[] }
  | { readonly kind: "savedSpotSaved"; readonly id: string }
  | { readonly kind: "savedSpotRemoved"; readonly id: string }
  | { readonly kind: "savedSpotsPersistFailed"; readonly error: SavedSpotsError }
  | { readonly kind: "forecastAlertsStarted"; readonly generation: number; readonly entries: readonly Readonly<{ id: string; key: string }>[] }
  | { readonly kind: "forecastAlertsCompleted"; readonly generation: number; readonly checks: readonly ForecastAlertCheck[] }
  | { readonly kind: "forecastAlertsDismissed" }
  | { readonly kind: "forecastAlertsShown" }
  | { readonly kind: "forecastPreviewStarted"; readonly request: number }
  | { readonly kind: "forecastPreviewCompleted"; readonly request: number; readonly result: ForecastDataResult; readonly checkedAt: number }
  | { readonly kind: "forecastPreviewRefresh" };

export const initialState: State = {
  placeSearch: initialPlaceSearch,
  basemap: "map", weatherOverlay: true, wayback: initialWayback,
  satellite: { available: false, phase: "idle", data: null, message: null },
  dayLookup: initialDayLookup, compassForecast: initialCompassForecast,
  telegram: initialTelegram,
  observations: initialObservations,
  phase: "idle", layer: "wind", run: null, step: 3, requestedKey: null, field: null,
  selected: null, modalOpen: false, error: null, playing: false,
  savedSpots: [], savedSpotsOpen: false, savedSpotsError: null,
  forecastAlerts: {}, forecastAlertsDismissed: false,
  history: {
    open: false, phase: "needsData", point: null,
    startYear: Math.max(2022, lastCompleteHistoryYear - 2), endYear: lastCompleteHistoryYear,
    criteria: defaultHistoryCriteria, requestedKey: null, data: null, error: null, selectedMonth: null, downloadRequested: false,
    savedSpotId: null, linkedSpotIds: [], linkedCatalog: [], sourceSpotId: null, saveName: "", alertEnabled: false, alertRules: [{ minDays: 1, withinDays: 14 }], alertLookAheadDays: 14, saveFeedback: null,
    forecastPreview: { phase: "idle", request: 0 },
  },
};

export const fieldKey = (run: ForecastRun, step: number, layer: Layer = "wind"): string => `${run.id}:${layer}:${step}`;
export const historyKey = (point: Point, startYear: number, endYear: number, conditions: ConditionSource = "both"): string =>
  `${point.latitude}:${point.longitude}:${startYear}:${endYear}${conditions === "both" ? "" : `:${conditions}`}`;

export { validCriteria, lastCompleteHistoryYear } from "./history.ts";

const selectionChanged = (state: State, point: Point): State => ({
  ...state, selected: point, modalOpen: false,
  observations: { ...state.observations, selectedId: null },
  history: { ...state.history, forecastPreview: resetForecastPreview(state.history.forecastPreview), open: false, point: null, phase: "needsData", requestedKey: null, data: null, error: null,
    downloadRequested: false, savedSpotId: null, linkedSpotIds: [], linkedCatalog: [], sourceSpotId: null, saveName: "", alertEnabled: false, alertRules: [{ minDays: 1, withinDays: 14 }], alertLookAheadDays: 14, saveFeedback: null },
});

const presentApp = (state: State, proposal: Proposal): State => {
  switch (proposal.kind) {
    case "placeSearchQueryChanged":
    case "placeSearchRequested":
    case "placeSearchStarted":
    case "placeSearchCompleted":
    case "placeSearchDismissed": {
      const placeSearch = presentPlaceSearch(state.placeSearch, proposal);
      const next = placeSearch === state.placeSearch ? state : { ...state, placeSearch };
      // Coordinates have a single exact result, so submission can move the marker immediately.
      return proposal.kind === "placeSearchRequested" && placeSearch.phase === "ready"
        ? presentApp(next, { kind: "placeSearchResultSelected", index: 0 }) : next;
    }
    case "placeSearchResultSelected": {
      const place = state.placeSearch.phase === "ready" && Number.isInteger(proposal.index) ? state.placeSearch.places[proposal.index] : null;
      if (!place) return state;
      const next = state.history.open ? { ...state, selected: place.point, history: {
        ...state.history, point: place.point, phase: "needsData" as const, requestedKey: null, data: null, error: null,
        selectedMonth: null, downloadRequested: false, saveFeedback: null, forecastPreview: resetForecastPreview(state.history.forecastPreview),
      } } : { ...selectionChanged(state, place.point), modalOpen: state.modalOpen };
      return { ...next, placeSearch: dismissPlaceSearch(state.placeSearch), savedSpotsOpen: false };
    }
    case "basemapSelected": return proposal.basemap === state.basemap || (proposal.basemap === "satellite" && !state.satellite.available) || (proposal.basemap === "wayback" && !state.wayback.available) ? state
      : { ...state, basemap: proposal.basemap, weatherOverlay: proposal.basemap === "map", satellite: {
        ...state.satellite, message: null, phase: proposal.basemap === "satellite" && !state.satellite.data && state.satellite.phase !== "loading" ? "needsData" : state.satellite.phase } };
    case "imageryViewportChanged":
    case "waybackRetry":
    case "waybackStarted":
    case "waybackCompleted":
    case "waybackCaptureSelected":
    case "waybackTilesFailed": return { ...state, wayback: presentWayback(state.wayback, proposal) };
    case "compassTimeModeChanged":
    case "compassForecastRefresh":
    case "compassClockTick":
    case "compassForecastStarted":
    case "compassForecastCompleted": return { ...state, compassForecast: presentCompassForecast(state.compassForecast, proposal) };
    case "weatherOverlayChanged": return { ...state, weatherOverlay: proposal.visible };
    case "satelliteStarted": return state.satellite.phase === "needsData" ? { ...state, satellite: { ...state.satellite, phase: "loading" } } : state;
    case "satelliteCompleted": return state.satellite.phase !== "loading" ? state : proposal.result.ok
      ? { ...state, satellite: { ...state.satellite, phase: "ready", data: proposal.result.data, message: null } }
      : { ...state, ...(state.basemap === "satellite" ? { basemap: "map" as const, weatherOverlay: true } : {}), satellite: { ...state.satellite, phase: "failed", data: null, message: proposal.result.message } };
    case "satelliteTilesFailed": return state.basemap !== "satellite" ? state
      : { ...state, basemap: "map", weatherOverlay: true, satellite: { ...state.satellite, phase: "failed", data: null,
        message: "Satellite imagery is unavailable. Map view restored; try again." } };
    case "dayLookupToggled":
    case "dayLookupDateChanged":
    case "dayLookupHoursChanged":
    case "dayLookupRequested":
    case "dayLookupStarted":
    case "dayLookupCompleted": {
      const dayLookup = presentDayLookup(state.dayLookup, proposal);
      return dayLookup === state.dayLookup ? state : { ...state, dayLookup };
    }
    case "telegramRequested":
    case "telegramStarted":
    case "telegramLoaded":
    case "telegramFailed":
    case "telegramLinkFailed":
    case "telegramSpotsChanged":
    case "telegramSyncRemembered": {
      const telegram = presentTelegram(state.telegram, proposal);
      return telegram === state.telegram ? state : { ...state, telegram };
    }
    case "telegramSpotRestored": {
      if (proposal.readOnly) return { ...state, selected: proposal.spot.point, modalOpen: false, savedSpotsOpen: false,
        history: { ...state.history, open: true, point: proposal.spot.point, phase: "needsData", data: null,
          startYear: proposal.spot.startYear, endYear: proposal.spot.endYear, criteria: proposal.spot.criteria,
          requestedKey: null, error: null, selectedMonth: null, savedSpotId: null,
          linkedSpotIds: proposal.spot.linkedSpotIds ?? [], linkedCatalog: proposal.linkedSpots ?? [], downloadRequested: false, sourceSpotId: proposal.spot.id,
          forecastPreview: resetForecastPreview(state.history.forecastPreview), saveName: proposal.spot.name, alertEnabled: false, alertRules: alertRulesFor(proposal.spot), alertLookAheadDays: forecastLookAhead(proposal.spot), saveFeedback: null } };
      return present({ ...state, savedSpots: [proposal.spot, ...(proposal.linkedSpots ?? []), ...state.savedSpots.filter((spot) => spot.id !== proposal.spot.id && !proposal.linkedSpots?.some((peer) => peer.id === spot.id))] },
        { kind: "savedSpotOpened", id: proposal.spot.id });
    }
    case "observationsToggled":
    case "observationLayerToggled":
    case "taiwanCoastalWindToggled":
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
    case "selectionCleared": return { ...state, selected: null, modalOpen: false, history: { ...state.history, forecastPreview: resetForecastPreview(state.history.forecastPreview), open: false, point: null, data: null, requestedKey: null, downloadRequested: false } };
    case "modalClosed": return { ...state, modalOpen: false };
    case "playToggled": return { ...state, playing: !state.playing };
    case "playTick":
      if (!state.playing || state.phase !== "ready") return state;
      return { ...state, phase: "needsField", step: state.step === 72 ? 3 : state.step + 3, field: null, requestedKey: null };
    case "retry": return { ...state, phase: state.run ? "needsField" : "idle", error: null };
    case "historyOpened":
      if (!state.selected) return state;
      return { ...state, modalOpen: false, history: {
        ...state.history, open: true, point: state.selected, forecastPreview: resetForecastPreview(state.history.forecastPreview),
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
        state.history.startYear === spot.startYear && state.history.endYear === spot.endYear &&
        conditionSource(state.history.criteria) === conditionSource(spot.criteria);
      return { ...state, selected: spot.point, modalOpen: false, savedSpotsOpen: false, history: {
        ...state.history, open: true, point: spot.point, forecastPreview: resetForecastPreview(state.history.forecastPreview), startYear: spot.startYear, endYear: spot.endYear,
        criteria: spot.criteria, phase: sameData ? "ready" : "needsData", data: sameData ? state.history.data : null,
        requestedKey: null, error: null, selectedMonth: null, downloadRequested: false,
        savedSpotId: spot.id, linkedSpotIds: spot.linkedSpotIds ?? [], linkedCatalog: [], sourceSpotId: null, saveName: spot.name, alertEnabled: spot.alertEnabled, alertRules: alertRulesFor(spot), alertLookAheadDays: forecastLookAhead(spot), saveFeedback: null,
      } };
    }
    case "savedSpotNameChanged":
      return state.history.open ? { ...state, history: { ...state.history, saveName: proposal.name, saveFeedback: null } } : state;
    case "savedSpotAlertChanged":
      return state.history.open ? { ...state, history: { ...state.history, alertEnabled: proposal.enabled, forecastPreview: resetForecastPreview(state.history.forecastPreview), saveFeedback: null } } : state;
    case "savedSpotAlertLookAheadChanged":
      return state.history.open && validForecastLookAhead(proposal.days)
        ? { ...state, history: { ...state.history, alertLookAheadDays: proposal.days, saveFeedback: null } } : state;
    case "savedSpotAlertRulesChanged":
      return state.history.open && validAlertRules(proposal.rules)
        ? { ...state, history: { ...state.history, alertRules: proposal.rules, saveFeedback: null } } : state;
    case "savedSpotLinksChanged":
      return state.history.open && validSpotLinks(proposal.ids) && !proposal.ids.includes(state.history.savedSpotId ?? state.history.sourceSpotId ?? "draft")
        ? { ...state, history: { ...state.history, linkedSpotIds: proposal.ids,
          forecastPreview: resetForecastPreview(state.history.forecastPreview), saveFeedback: null } } : state;
    case "savedSpotSaved": {
      const history = state.history;
      if (!history.open || !history.point) return state;
      const name = history.saveName.trim();
      if (!name || name.length > 80) return { ...state, history: { ...history, saveFeedback: "nameRequired" } };
      const spot: SavedSpot = { id: proposal.id, name, point: history.point,
        startYear: history.startYear, endYear: history.endYear, criteria: history.criteria,
        alertEnabled: history.alertEnabled, alertMinDays: history.alertRules[0].minDays, alertRules: history.alertRules, alertLookAheadDays: history.alertLookAheadDays, linkedSpotIds: history.linkedSpotIds.filter((id) => id !== proposal.id) };
      // Shared phone links remain ephemeral until an explicit save. Preserve the
      // linked conditions then, without opting those dependency points into alerts.
      const imported = linkedSpotGroup(draftSavedSpot(history), history.linkedCatalog).spots.slice(1)
        .filter((peer) => !state.savedSpots.some((saved) => saved.id === peer.id))
        .map((peer) => ({ ...peer, alertEnabled: false,
          linkedSpotIds: peer.linkedSpotIds?.map((id) => id === history.sourceSpotId ? proposal.id : id) }));
      const catalog = [...state.savedSpots, ...imported];
      const exists = catalog.some((item) => item.id === proposal.id);
      return { ...state, savedSpots: exists ? catalog.map((item) => item.id === proposal.id ? spot : item) : [spot, ...catalog],
        savedSpotsError: null, history: { ...history, savedSpotId: proposal.id, saveName: name, linkedSpotIds: spot.linkedSpotIds ?? [], linkedCatalog: [], sourceSpotId: null,
          forecastPreview: history.savedSpotId === proposal.id ? history.forecastPreview : resetForecastPreview(history.forecastPreview), saveFeedback: "saved" } };
    }
    case "savedSpotRemoved": {
      const spots = state.savedSpots.filter((spot) => spot.id !== proposal.id);
      if (spots.length === state.savedSpots.length) return state;
      const alerts = { ...state.forecastAlerts };
      delete alerts[proposal.id];
      const next = { ...state, savedSpots: spots, savedSpotsError: null, forecastAlerts: alerts,
        history: { ...state.history, forecastPreview: resetForecastPreview(state.history.forecastPreview),
          ...(state.history.savedSpotId === proposal.id ? { savedSpotId: null, saveFeedback: null } : {}) } };
      return state.history.savedSpotId === proposal.id ? present(next, { kind: "selectionCleared" }) : next;
    }
    case "savedSpotsPersistFailed": return { ...state, savedSpotsError: proposal.error,
      history: { ...state.history, saveFeedback: "storageFailed" } };
    case "forecastAlertsStarted": {
      const alerts = { ...state.forecastAlerts };
      const newRules = proposal.entries.some((entry) => alerts[entry.id]?.key !== entry.key);
      for (const entry of proposal.entries) {
        const spot = state.savedSpots.find((item) => item.id === entry.id);
        if (spot?.alertEnabled && forecastAlertKey(spot, state.savedSpots) === entry.key) {
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
        if (!spot?.alertEnabled || forecastAlertKey(spot, state.savedSpots) !== check.key || alerts[check.id]?.generation !== proposal.generation) continue;
        alerts[check.id] = check.ok ? { kind: "ready", key: check.key, generation: proposal.generation, summary: check.summary }
          : { kind: "failed", key: check.key, generation: proposal.generation, error: check.error };
      }
      return { ...state, forecastAlerts: alerts };
    }
    case "forecastPreviewStarted":
      if (!state.history.open || !state.history.alertEnabled || state.history.forecastPreview.phase !== "idle" ||
        state.history.forecastPreview.request !== proposal.request) return state;
      return { ...state, history: { ...state.history, forecastPreview: { phase: "loading", request: proposal.request } } };
    case "forecastPreviewCompleted":
      if (state.history.forecastPreview.phase !== "loading" || state.history.forecastPreview.request !== proposal.request) return state;
      return { ...state, history: { ...state.history, forecastPreview: proposal.result.ok
        ? { phase: "ready", request: proposal.request, data: proposal.result.data, checkedAt: proposal.checkedAt }
        : { phase: "failed", request: proposal.request, error: proposal.result.error } } };
    case "forecastPreviewRefresh":
      return { ...state, history: { ...state.history, forecastPreview: resetForecastPreview(state.history.forecastPreview) } };
    case "forecastAlertsDismissed": return { ...state, forecastAlertsDismissed: true };
    case "forecastAlertsShown": return { ...state, forecastAlertsDismissed: false };
    case "historyClosed": return { ...state, history: { ...state.history, open: false, requestedKey: null, downloadRequested: false, forecastPreview: resetForecastPreview(state.history.forecastPreview) } };
    case "historyYearsChanged":
      if (!Number.isInteger(proposal.startYear) || !Number.isInteger(proposal.endYear) ||
        proposal.startYear < 2022 || proposal.endYear > lastCompleteHistoryYear ||
        proposal.startYear > proposal.endYear || proposal.endYear - proposal.startYear > 4) return state;
      if (proposal.startYear === state.history.startYear && proposal.endYear === state.history.endYear) return state;
      return { ...state, history: { ...state.history, startYear: proposal.startYear, endYear: proposal.endYear,
        phase: "needsData", requestedKey: null, data: null, error: null, selectedMonth: null, saveFeedback: null } };
    case "historyCriteriaChanged": {
      if (!validCriteria(proposal.criteria)) return state;
      const changedSource = conditionSource(proposal.criteria) !== conditionSource(state.history.criteria);
      return { ...state, history: { ...state.history, criteria: proposal.criteria, selectedMonth: null, saveFeedback: null,
        ...(changedSource ? { phase: "needsData", requestedKey: null, data: null, error: null,
          forecastPreview: resetForecastPreview(state.history.forecastPreview) } : {}) } };
    }
    case "historyMonthSelected":
      return proposal.month >= 0 && proposal.month < 12
        ? { ...state, history: { ...state.history, selectedMonth: proposal.month } } : state;
    case "historyLoadStarted": return { ...state, history: { ...state.history, phase: "loading", requestedKey: proposal.key, error: null } };
    case "historyLoaded":
      if (!state.history.open || proposal.key !== state.history.requestedKey || !state.history.point ||
        proposal.key !== historyKey(state.history.point, state.history.startYear, state.history.endYear, conditionSource(state.history.criteria))) return state;
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

export const present = (state: State, proposal: Proposal): State => {
  let next = presentApp(state, proposal);
  if (["locationSelected", "locationDragged", "selectionCleared", "savedSpotOpened", "telegramSpotRestored", "modalClosed", "historyClosed", "savedSpotsToggled", "observationsToggled"].includes(proposal.kind)) {
    const placeSearch = dismissPlaceSearch(next.placeSearch);
    if (placeSearch !== next.placeSearch) next = { ...next, placeSearch };
  }
  const dayLookup = alignDayLookup(next.dayLookup, next.history.open ? next.history.point : next.selected);
  const wayback = alignWayback(next.wayback, next.selected, next.basemap === "wayback");
  const compassForecast = alignCompassForecast(next.compassForecast, next.history.open ? next.history.point : null, conditionSource(next.history.criteria));
  return dayLookup === next.dayLookup && wayback === next.wayback && compassForecast === next.compassForecast ? next : { ...next, dayLookup, wayback, compassForecast };
};

export type Effect =
  | PlaceSearchEffect
  | CompassForecastEffect
  | WaybackEffect
  | { readonly kind: "loadSatellite" }
  | DayLookupEffect
  | ObservationEffect
  | { readonly kind: "loadForecastPreview"; readonly point: Point; readonly spot: SavedSpot; readonly catalog: readonly SavedSpot[]; readonly request: number }
  | { readonly kind: "discover"; readonly layer: Layer }
  | { readonly kind: "load"; readonly run: ForecastRun; readonly step: number; readonly key: string; readonly layer: Layer }
  | { readonly kind: "loadHistory"; readonly conditions: ConditionSource; readonly point: Point; readonly startYear: number; readonly endYear: number; readonly key: string }
  | { readonly kind: "downloadHistory"; readonly data: HistoricalData; readonly criteria: HistoryCriteria };

export const draftSavedSpot = (history: HistoryPanel): SavedSpot => ({
  id: history.savedSpotId ?? history.sourceSpotId ?? "draft", name: history.saveName || "This spot",
  point: history.point!, criteria: history.criteria, startYear: history.startYear, endYear: history.endYear,
  alertEnabled: history.alertEnabled, alertMinDays: history.alertRules[0].minDays,
  alertRules: history.alertRules, alertLookAheadDays: history.alertLookAheadDays, linkedSpotIds: history.linkedSpotIds,
});

export const nap = (state: State): Effect | null => {
  const search = placeSearchEffect(state.placeSearch);
  if (search) return search;
  const imagery = waybackEffect(state.wayback, state.basemap === "wayback");
  if (imagery) return imagery;
  if (state.satellite.phase === "needsData") return { kind: "loadSatellite" };
  const day = dayLookupEffect(state.dayLookup, state.modalOpen || state.history.open);
  if (day) return day;
  if (state.history.downloadRequested && state.history.data) {
    return { kind: "downloadHistory", data: state.history.data, criteria: state.history.criteria };
  }
  if (state.history.open && state.history.phase === "needsData" && state.history.point) {
    return { kind: "loadHistory", conditions: conditionSource(state.history.criteria), point: state.history.point, startYear: state.history.startYear,
      endYear: state.history.endYear, key: historyKey(state.history.point, state.history.startYear, state.history.endYear, conditionSource(state.history.criteria)) };
  }
  if (state.history.open && state.history.alertEnabled && state.history.point && state.history.forecastPreview.phase === "idle") {
    return { kind: "loadForecastPreview", point: state.history.point, spot: draftSavedSpot(state.history),
      catalog: [...state.history.linkedCatalog, ...state.savedSpots], request: state.history.forecastPreview.request };
  }
  const compass = compassForecastEffect(state.compassForecast);
  if (compass) return compass;
  if (state.phase === "idle") return { kind: "discover", layer: state.layer };
  if (state.phase === "needsField" && state.run) {
    return { kind: "load", run: state.run, step: state.step, key: fieldKey(state.run, state.step, state.layer), layer: state.layer };
  }
  return observationEffect(state.observations);
};

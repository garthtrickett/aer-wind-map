import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { render } from "lit-html";
import { discoverLatest } from "./ecmwf.ts";
import { historyCsv, loadHistoricalSpot } from "./history.ts";
import { bearingFromPointer, createHistoryMiniMap, defaultHistoryMapZoom, type BearingHandle } from "./history-compass.ts";
import { createWindMap } from "./map.ts";
import { createWindRenderer } from "./renderer.ts";
import { createForecastWorker } from "./worker-client.ts";
import { fieldKey, initialState, nap, present, type Effect, type Proposal, type State } from "./model.ts";
import { readSavedSpots, writeSavedSpots } from "./saved-spots.ts";
import { forecastAlertKey, loadForecastAlerts, loadForecastGroup } from "./forecast-alerts.ts";
import { flagView, view } from "./view.ts";
import type { ForecastField } from "./wave.ts";
import { loadObservations } from "./observations.ts";
import { loadBuoyHistory, buoyHistoryCsv } from "./buoy-history.ts";
import { createObservationMarkers } from "./observations-map.ts";
import { telegramRequest, telegramSpotsKey } from "./telegram-model.ts";
import { isSavedSpot } from "./saved-spots.ts";

const requireElement = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
};

const requireCanvas = (id: string): HTMLCanvasElement => {
  const element = requireElement(id);
  if (!(element instanceof HTMLCanvasElement)) throw new Error(`#${id} must be a canvas`);
  return element;
};

const ui = requireElement("ui");
const mapElement = requireElement("map");
const colorCanvas = requireCanvas("wind-color");
const arrowsCanvas = requireCanvas("wind-arrows");
const flag = requireElement("selected-flag");
const forecastWorker = createForecastWorker();
const cache = new Map<string, ForecastField>();
let state: State = initialState;
let displayedField: ForecastField | null = null;
let selectedPoint: State["selected"] = null;
let displayedSavedSpots: State["savedSpots"] = initialState.savedSpots;
let alertSignature = "";
let nextAlertRefreshAt = 0;
let alertGeneration = 0;
let overlayKind: "details" | "history" | "observation" | null = null;
let previousFocus: HTMLElement | null = null;
let playTimer: number | null = null;
let miniMapZoom = defaultHistoryMapZoom;
let miniMap: Readonly<{ element: HTMLElement; latitude: number; longitude: number; remove: () => void; setZoom: (zoom: number) => void }> | null = null;

const syncMiniMap = (): void => {
  const element = ui.querySelector<HTMLElement>("#history-mini-map");
  const point = state.history.open ? state.history.point : null;
  if (miniMap && (!point || miniMap.element !== element || miniMap.latitude !== point.latitude || miniMap.longitude !== point.longitude)) {
    miniMap.remove();
    miniMap = null;
  }
  if (!point) miniMapZoom = defaultHistoryMapZoom;
  if (element && point && !miniMap) miniMap = { element, ...point, ...createHistoryMiniMap(element, point, miniMapZoom) };
  const slider = ui.querySelector<HTMLInputElement>("#history-map-zoom");
  const output = ui.querySelector<HTMLOutputElement>("#history-map-zoom-value");
  if (slider) slider.value = String(miniMapZoom);
  if (output) output.value = String(miniMapZoom);
};

ui.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.id !== "history-map-zoom") return;
  miniMapZoom = Number(event.target.value);
  miniMap?.setZoom(miniMapZoom);
  const output = ui.querySelector<HTMLOutputElement>("#history-map-zoom-value");
  if (output) output.value = String(miniMapZoom);
});

let compassDrag: Readonly<{ pointerId: number; handle: SVGCircleElement; field: BearingHandle }> | null = null;
const setCompassBearing = (event: PointerEvent, field: BearingHandle): void => {
  const svg = ui.querySelector<SVGSVGElement>(".history-compass-overlay");
  if (!svg) return;
  const bearing = bearingFromPointer(event, svg);
  if (state.history.criteria[field] === bearing) return;
  dispatch({ kind: "historyCriteriaChanged", criteria: { ...state.history.criteria, [field]: bearing } });
};

ui.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  const handle = event.target.closest("[data-bearing-handle]");
  if (!(handle instanceof SVGCircleElement)) return;
  const field = handle.dataset.bearingHandle as BearingHandle;
  compassDrag = { pointerId: event.pointerId, handle, field };
  handle.setPointerCapture(event.pointerId);
  event.preventDefault();
});
ui.addEventListener("pointermove", (event) => {
  if (!compassDrag || compassDrag.pointerId !== event.pointerId) return;
  setCompassBearing(event, compassDrag.field);
  event.preventDefault();
});
ui.addEventListener("pointerup", (event) => {
  if (!compassDrag || compassDrag.pointerId !== event.pointerId) return;
  setCompassBearing(event, compassDrag.field);
  const handle = compassDrag.handle;
  compassDrag = null;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  event.preventDefault();
});
ui.addEventListener("pointercancel", (event) => {
  if (compassDrag?.pointerId === event.pointerId) compassDrag = null;
});
ui.addEventListener("keydown", (event) => {
  if (!(event.target instanceof SVGCircleElement)) return;
  const field = event.target.dataset.bearingHandle as BearingHandle | undefined;
  if (!field || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const current = state.history.criteria[field];
  const next = event.key === "Home" ? 0 : event.key === "End" ? field.endsWith("End") ? 360 : 359
    : (current + (event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1) + 360) % 360;
  dispatch({ kind: "historyCriteriaChanged", criteria: { ...state.history.criteria, [field]: next } });
  event.preventDefault();
});

const windMap = createWindMap({ element: mapElement, flag,
  onSelect: (point) => dispatch({ kind: "locationSelected", point }),
  onSavedSpotSelect: (id) => dispatch({ kind: "savedSpotOpened", id }),
});
const windRenderer = createWindRenderer(windMap.map, windMap.maplibre, colorCanvas, arrowsCanvas);
const observationMarkers = createObservationMarkers(windMap.map, (id) => dispatch({ kind: "observationSelected", id }));
let displayedObservations = state.observations;
const observationViewport = (): void => {
  const bounds = windMap.map.getBounds();
  const normalize = (longitude: number): number => ((longitude + 180) % 360 + 360) % 360 - 180;
  dispatch({ kind: "observationViewportChanged", zoom: windMap.map.getZoom(), bounds: {
    south: Math.max(-90, bounds.getSouth()), north: Math.min(90, bounds.getNorth()),
    west: normalize(bounds.getWest()), east: normalize(bounds.getEast()),
  } });
};
windMap.map.on("moveend", observationViewport);
let drag: Readonly<{
  pointerId: number;
  handle: HTMLElement;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
}> | null = null;

flag.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !state.selected || !(event.target instanceof Element)) return;
  const handle = event.target.closest("[data-flag-drag]");
  if (!(handle instanceof HTMLElement)) return;
  const rect = mapElement.getBoundingClientRect();
  const anchor = windMap.screenPoint(state.selected);
  drag = {
    pointerId: event.pointerId,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: anchor.x - (event.clientX - rect.left),
    offsetY: anchor.y - (event.clientY - rect.top),
    moved: false,
  };
  handle.setPointerCapture(event.pointerId);
  flag.classList.add("dragging");
  event.preventDefault();
  event.stopPropagation();
});

const dragPoint = (event: PointerEvent): void => {
  if (!drag) return;
  const rect = mapElement.getBoundingClientRect();
  dispatch({ kind: "locationDragged", point: windMap.pointAt({
    x: event.clientX - rect.left + drag.offsetX,
    y: event.clientY - rect.top + drag.offsetY,
  }) });
};

flag.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 4) return;
  drag = { ...drag, moved: true };
  dragPoint(event);
  event.preventDefault();
});

flag.addEventListener("pointerup", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const ended = drag;
  if (ended.moved) dragPoint(event);
  drag = null;
  flag.classList.remove("dragging");
  if (ended.handle.hasPointerCapture(event.pointerId)) ended.handle.releasePointerCapture(event.pointerId);
  if (!ended.moved) dispatch({ kind: "detailsOpened" });
  event.preventDefault();
  event.stopPropagation();
});
flag.addEventListener("pointercancel", (event) => {
  if (drag?.pointerId === event.pointerId) { drag = null; flag.classList.remove("dragging"); }
});
flag.addEventListener("lostpointercapture", (event) => {
  if (drag?.pointerId === event.pointerId) { drag = null; flag.classList.remove("dragging"); }
});

const runEffect = (effect: Effect): void => {
  if (effect.kind === "loadBuoyHistory") {
    dispatch({ kind: "observationHistoryStarted", key: effect.key });
    void loadBuoyHistory(effect.station, effect.date).then((result) => dispatch(result.ok
      ? { kind: "observationHistoryLoaded", key: effect.key, data: result.value }
      : { kind: "observationHistoryFailed", key: effect.key, message: result.error.message }));
    return;
  }
  if (effect.kind === "downloadBuoyHistory") {
    dispatch({ kind: "observationHistoryDownloaded" });
    const url = URL.createObjectURL(new Blob([buoyHistoryCsv(effect.data)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `aer-wave-observations-${effect.data.station.code}-${effect.data.date}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (effect.kind === "loadObservations") {
    dispatch({ kind: "observationsStarted", key: effect.key });
    void loadObservations(effect.query).then((result) => dispatch(result.ok
      ? { kind: "observationsLoaded", key: effect.key, data: result.value }
      : { kind: "observationsFailed", key: effect.key, message: result.error.message }));
    return;
  }
  if (effect.kind === "downloadHistory") {
    const csv = historyCsv(effect.data, effect.criteria);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `aer-history-${effect.data.startYear}-${effect.data.endYear}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    dispatch({ kind: "historyDownloadCompleted" });
    return;
  }
  if (effect.kind === "loadForecastPreview") {
    dispatch({ kind: "forecastPreviewStarted", request: effect.request });
    void loadForecastGroup(effect.spot, effect.catalog).then((result) => dispatch({
      kind: "forecastPreviewCompleted", request: effect.request, result, checkedAt: Date.now(),
    }));
    return;
  }
  if (effect.kind === "loadHistory") {
    dispatch({ kind: "historyLoadStarted", key: effect.key });
    void loadHistoricalSpot({ point: effect.point, startYear: effect.startYear, endYear: effect.endYear, conditions: effect.conditions }).then((result) => {
      dispatch(result.ok
        ? { kind: "historyLoaded", key: effect.key, data: result.value }
        : { kind: "historyFailed", key: effect.key, error: result.error });
    });
    return;
  }
  if (effect.kind === "discover") {
    dispatch({ kind: "discoverStarted" });
    void discoverLatest(fetch, effect.layer).then((result) => {
      dispatch(result.ok
        ? { kind: "runFound", run: result.value, layer: effect.layer }
        : { kind: "failed", key: null, layer: effect.layer, error: result.error });
    });
    return;
  }

  dispatch({ kind: "loadStarted", key: effect.key });
  const cached = cache.get(effect.key);
  if (cached) {
    dispatch({ kind: "fieldLoaded", key: effect.key, field: cached });
    return;
  }
  void forecastWorker.load(effect.run, effect.step, effect.key, effect.layer).then((result) => {
    if (result.ok) {
      cache.set(effect.key, result.value);
      while (cache.size > 3) cache.delete(cache.keys().next().value!);
      dispatch({ kind: "fieldLoaded", key: effect.key, field: result.value });
    } else {
      dispatch({ kind: "failed", key: effect.key, layer: effect.layer, error: result.error });
    }
  });
};

const refreshForecastAlerts = (): void => {
  const spots = state.savedSpots.filter((spot) => spot.alertEnabled);
  if (!spots.length) { alertSignature = ""; return; }
  const signature = JSON.stringify(spots.map((spot) => forecastAlertKey(spot, state.savedSpots)));
  const now = new Date();
  if (signature === alertSignature && now.getTime() < nextAlertRefreshAt) return;
  alertSignature = signature;
  nextAlertRefreshAt = now.getTime() + 6 * 60 * 60 * 1000;
  const generation = ++alertGeneration;
  dispatch({ kind: "forecastAlertsStarted", generation, entries: spots.map((spot) => ({ id: spot.id, key: forecastAlertKey(spot, state.savedSpots) })) });
  void loadForecastAlerts(spots, now, fetch, state.savedSpots).then((checks) => {
    if (generation === alertGeneration && checks.some((check) => !check.ok))
      nextAlertRefreshAt = Math.min(nextAlertRefreshAt, Date.now() + 15 * 60 * 1000);
    dispatch({ kind: "forecastAlertsCompleted", generation, checks });
  });
};

function dispatch(proposal: Proposal): void {
  const previous = state;
  let next = present(state, proposal);
  if (next === state) return;
  if ((proposal.kind === "savedSpotSaved" || proposal.kind === "savedSpotRemoved" || proposal.kind === "telegramSpotRestored") && next.savedSpots !== previous.savedSpots) {
    const result = writeSavedSpots(() => window.localStorage, next.savedSpots);
    if (!result.ok) next = present(previous, { kind: "savedSpotsPersistFailed", error: result.error });
  }
  state = next;
  if (state.telegram.syncedKey !== previous.telegram.syncedKey) {
    try { window.localStorage.setItem("aer.telegram.synced.v1", state.telegram.syncedKey ?? ""); }
    catch { /* Sync status remains visible; server monitoring is already durable. */ }
  }
  arrowsCanvas.hidden = state.layer === "waves";
  render(view(state, dispatch, windMap.center, Date.now()), ui);
  render(flagView(state, dispatch), flag);
  syncMiniMap();
  if (displayedObservations !== state.observations) {
    displayedObservations = state.observations;
    if (previous.observations.data !== state.observations.data || previous.observations.buoys !== state.observations.buoys ||
      previous.observations.wind !== state.observations.wind || (previous.observations.zoom >= 5) !== (state.observations.zoom >= 5)) {
      observationMarkers.update(state.observations.zoom >= 5 ? state.observations.data?.stations ?? [] : [], state.observations.buoys, state.observations.wind);
    }
  }

  if (displayedField !== state.field) {
    displayedField = state.field;
    windRenderer.setField(displayedField);
  }
  if (selectedPoint !== state.selected) {
    selectedPoint = state.selected;
    windMap.select(selectedPoint);
  }
  if (displayedSavedSpots !== state.savedSpots) {
    displayedSavedSpots = state.savedSpots;
    windMap.setSavedSpots(displayedSavedSpots);
    queueMicrotask(refreshForecastAlerts);
    queueMicrotask(() => dispatch({ kind: "telegramSpotsChanged", key: telegramSpotsKey(state.savedSpots), edited: true }));
  }
  if ((proposal.kind === "savedSpotOpened" && state.history.savedSpotId === proposal.id || proposal.kind === "telegramSpotRestored") && state.history.point) {
    windMap.focus(state.history.point);
  }
  const nextOverlay = state.observations.selectedId ? "observation" : state.history.open ? "history" : state.modalOpen ? "details" : null;
  if (nextOverlay !== overlayKind) {
    if (overlayKind === null && nextOverlay !== null) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayKind = nextOverlay;
    if (nextOverlay !== null) {
      requestAnimationFrame(() => ui.querySelector<HTMLElement>(".close-button")?.focus());
    } else {
      previousFocus?.focus();
      previousFocus = null;
    }
  }
  if (state.playing && playTimer === null) playTimer = window.setInterval(() => dispatch({ kind: "playTick" }), 1600);
  if (!state.playing && playTimer !== null) { clearInterval(playTimer); playTimer = null; }

  const effect = nap(state);
  if (effect) runEffect(effect);
  const telegram = state.telegram.request;
  if (telegram && !telegram.started) {
    const spots = state.savedSpots;
    const revision = state.telegram.status.revision;
    dispatch({ kind: "telegramStarted", id: telegram.id, key: telegramSpotsKey(spots) });
    void telegramRequest(telegram.action, spots, revision).then(
      (reply) => dispatch({ kind: "telegramLoaded", id: telegram.id, reply }),
      (cause) => dispatch({ kind: "telegramFailed", id: telegram.id,
        message: cause instanceof Error ? cause.message : "Telegram is unavailable. Try again." }),
    );
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.observations.selectedId) dispatch({ kind: "observationClosed" });
  else if (event.key === "Escape" && state.history.open) dispatch({ kind: "historyClosed" });
  else if (event.key === "Escape" && state.modalOpen) dispatch({ kind: "modalClosed" });
  if (event.key !== "Tab" || (!state.modalOpen && !state.history.open && !state.observations.selectedId)) return;
  const dialog = ui.querySelector<HTMLElement>("[role=dialog]");
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

const alertTimer = window.setInterval(refreshForecastAlerts, 15 * 60 * 1000);
const observationTimer = window.setInterval(() => { if (!document.hidden) dispatch({ kind: "observationsRefreshed" }); }, 5 * 60 * 1000);
const refreshTelegram = () => {
  if (!document.hidden && (state.savedSpotsOpen || state.telegram.connectUrl)) dispatch({ kind: "telegramRequested", action: "status" });
};
const telegramTimer = window.setInterval(refreshTelegram, 10_000);
window.addEventListener("focus", refreshTelegram);
window.addEventListener("pagehide", () => { forecastWorker.terminate(); miniMap?.remove(); observationMarkers.remove(); clearInterval(alertTimer); clearInterval(observationTimer); clearInterval(telegramTimer); });
const savedSpotsResult = readSavedSpots(() => window.localStorage);
state = present(state, savedSpotsResult.ok
  ? { kind: "savedSpotsLoaded", spots: savedSpotsResult.value }
  : { kind: "savedSpotsLoadFailed", error: savedSpotsResult.error });
displayedSavedSpots = state.savedSpots;
windMap.setSavedSpots(displayedSavedSpots);
state = present(state, { kind: "telegramSpotsChanged", key: telegramSpotsKey(state.savedSpots), edited: false });
try { state = present(state, { kind: "telegramSyncRemembered", key: window.localStorage.getItem("aer.telegram.synced.v1") }); }
catch { /* Local preset storage already reports its own error. */ }
queueMicrotask(refreshForecastAlerts);
const startingBounds = windMap.map.getBounds();
state = present(state, { kind: "observationViewportChanged", zoom: windMap.map.getZoom(), bounds: {
  south: Math.max(-90, startingBounds.getSouth()), north: Math.min(90, startingBounds.getNorth()), west: -180, east: 180,
} });
render(view(state, dispatch, windMap.center, Date.now()), ui);
render(flagView(state, dispatch), flag);
const firstEffect = nap(state);
if (firstEffect) runEffect(firstEffect);
dispatch({ kind: "telegramRequested", action: "status" });

const linkedAlert = new URL(window.location.href).searchParams.get("alert");
const forecastToken = new URLSearchParams(window.location.hash.slice(1)).get("forecast");
if ((linkedAlert && linkedAlert.length <= 100) || forecastToken) {
  // Fragments are never sent in navigation requests or Referer headers. Remove
  // the capability from the address bar after taking our local copy.
  if (forecastToken) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  void fetch(forecastToken ? "/api/telegram/view" : `/api/telegram/spot?id=${encodeURIComponent(linkedAlert!)}`, {
    credentials: "same-origin", signal: AbortSignal.timeout(15_000),
    ...(forecastToken ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: forecastToken }) } : {}),
  })
    .then(async (response) => {
      const raw = await response.json();
      if (!response.ok || !isSavedSpot(raw.spot)) throw new Error("This forecast link expired or its alert was removed.");
      dispatch({ kind: "telegramSpotRestored", spot: raw.spot, linkedSpots: Array.isArray(raw.linkedSpots) && raw.linkedSpots.every(isSavedSpot) ? raw.linkedSpots : [], readOnly: !!forecastToken });
    }).catch(() => {
      if (!state.savedSpotsOpen) dispatch({ kind: "savedSpotsToggled" });
      // A link never imports an unowned or malformed preset.
      dispatch({ kind: "telegramLinkFailed" });
    });
}

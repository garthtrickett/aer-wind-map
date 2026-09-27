import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { render } from "lit-html";
import { discoverLatest } from "./ecmwf.ts";
import { historyCsv, loadHistoricalSpot } from "./history.ts";
import { bearingFromPointer, createHistoryMiniMap, type BearingHandle } from "./history-compass.ts";
import { createWindMap } from "./map.ts";
import { createWindRenderer } from "./renderer.ts";
import { createForecastWorker } from "./worker-client.ts";
import { fieldKey, initialState, nap, present, type Effect, type Proposal, type State } from "./model.ts";
import { flagView, view } from "./view.ts";
import type { ForecastField } from "./wave.ts";

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
let overlayKind: "details" | "history" | null = null;
let previousFocus: HTMLElement | null = null;
let playTimer: number | null = null;
let miniMap: Readonly<{ element: HTMLElement; latitude: number; longitude: number; remove: () => void }> | null = null;

const syncMiniMap = (): void => {
  const element = ui.querySelector<HTMLElement>("#history-mini-map");
  const point = state.history.open ? state.history.point : null;
  if (miniMap && (!point || miniMap.element !== element || miniMap.latitude !== point.latitude || miniMap.longitude !== point.longitude)) {
    miniMap.remove();
    miniMap = null;
  }
  if (element && point && !miniMap) miniMap = { element, ...point, ...createHistoryMiniMap(element, point) };
};

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

const windMap = createWindMap({ element: mapElement, flag, onSelect: (point) => dispatch({ kind: "locationSelected", point }) });
const windRenderer = createWindRenderer(windMap.map, windMap.maplibre, colorCanvas, arrowsCanvas);
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
  if (effect.kind === "loadHistory") {
    dispatch({ kind: "historyLoadStarted", key: effect.key });
    void loadHistoricalSpot({ point: effect.point, startYear: effect.startYear, endYear: effect.endYear }).then((result) => {
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

function dispatch(proposal: Proposal): void {
  const next = present(state, proposal);
  if (next === state) return;
  state = next;
  arrowsCanvas.hidden = state.layer === "waves";
  render(view(state, dispatch, windMap.center), ui);
  render(flagView(state, dispatch), flag);
  syncMiniMap();

  if (displayedField !== state.field) {
    displayedField = state.field;
    windRenderer.setField(displayedField);
  }
  if (selectedPoint !== state.selected) {
    selectedPoint = state.selected;
    windMap.select(selectedPoint);
  }
  const nextOverlay = state.history.open ? "history" : state.modalOpen ? "details" : null;
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
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.history.open) dispatch({ kind: "historyClosed" });
  else if (event.key === "Escape" && state.modalOpen) dispatch({ kind: "modalClosed" });
  if (event.key !== "Tab" || (!state.modalOpen && !state.history.open)) return;
  const dialog = ui.querySelector<HTMLElement>("[role=dialog]");
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

window.addEventListener("pagehide", () => { forecastWorker.terminate(); miniMap?.remove(); });
render(view(state, dispatch, windMap.center), ui);
render(flagView(state, dispatch), flag);
const firstEffect = nap(state);
if (firstEffect) runEffect(firstEffect);

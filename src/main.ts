import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { render } from "lit-html";
import { discoverLatest } from "./ecmwf.ts";
import { createWindMap } from "./map.ts";
import { createWindRenderer } from "./renderer.ts";
import { createForecastWorker } from "./worker-client.ts";
import { fieldKey, initialState, nap, present, type Effect, type Proposal, type State } from "./model.ts";
import { view } from "./view.ts";
import type { WindField } from "./wind.ts";

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
const forecastWorker = createForecastWorker();
const cache = new Map<string, WindField>();
let state: State = initialState;
let displayedField: WindField | null = null;
let selectedPoint: State["selected"] = null;
let modalWasOpen = false;
let previousFocus: HTMLElement | null = null;
let playTimer: number | null = null;

const windMap = createWindMap(mapElement, (point) => dispatch({ kind: "locationSelected", point }));
const windRenderer = createWindRenderer(windMap.map, colorCanvas, arrowsCanvas);

const runEffect = (effect: Effect): void => {
  if (effect.kind === "discover") {
    dispatch({ kind: "discoverStarted" });
    void discoverLatest().then((result) => {
      dispatch(result.ok
        ? { kind: "runFound", run: result.value }
        : { kind: "failed", key: null, error: result.error });
    });
    return;
  }

  dispatch({ kind: "loadStarted", key: effect.key });
  const cached = cache.get(effect.key);
  if (cached) {
    dispatch({ kind: "fieldLoaded", key: effect.key, field: cached });
    return;
  }
  void forecastWorker.load(effect.run, effect.step, effect.key).then((result) => {
    if (result.ok) {
      cache.set(effect.key, result.value);
      while (cache.size > 3) cache.delete(cache.keys().next().value!);
      dispatch({ kind: "fieldLoaded", key: effect.key, field: result.value });
    } else {
      dispatch({ kind: "failed", key: effect.key, error: result.error });
    }
  });
};

function dispatch(proposal: Proposal): void {
  const next = present(state, proposal);
  if (next === state) return;
  state = next;
  render(view(state, dispatch, windMap.center), ui);

  if (displayedField !== state.field) {
    displayedField = state.field;
    windRenderer.setField(displayedField);
  }
  if (selectedPoint !== state.selected) {
    selectedPoint = state.selected;
    windMap.select(selectedPoint);
  }
  if (state.modalOpen !== modalWasOpen) {
    modalWasOpen = state.modalOpen;
    if (state.modalOpen) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
  if (event.key === "Escape" && state.modalOpen) dispatch({ kind: "modalClosed" });
  if (event.key !== "Tab" || !state.modalOpen) return;
  const dialog = ui.querySelector<HTMLElement>("[role=dialog]");
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

window.addEventListener("pagehide", () => forecastWorker.terminate());
render(view(state, dispatch, windMap.center), ui);
const firstEffect = nap(state);
if (firstEffect) runEffect(firstEffect);

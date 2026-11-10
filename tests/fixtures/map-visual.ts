import "leaflet/dist/leaflet.css";
import "../../src/style.css";
import { render } from "lit-html";
import { createWindMap } from "../../src/map.ts";
import { createWindRenderer } from "../../src/renderer.ts";
import { flagView } from "../../src/view.ts";
import { initialState } from "../../src/model.ts";
import { defaultHistoryCriteria } from "../../src/history.ts";
import type { WaveField } from "../../src/wave.ts";
import type { SavedSpot } from "../../src/saved-spots.ts";
const element = document.querySelector<HTMLElement>("#map")!;
const flag = document.querySelector<HTMLElement>("#selected-flag")!;
const color = document.querySelector<HTMLCanvasElement>("#wind-color")!;
const arrows = document.querySelector<HTMLCanvasElement>("#wind-arrows")!;
const map = createWindMap({ element, flag, onSelect: () => {}, onSavedSpotSelect: () => {}, onSatelliteError: () => {} });
const renderer = createWindRenderer(map.map, map.maplibre, color, arrows);
const size = 360 * 181;
const wave: WaveField = { kind: "waves", source: "mfwam-primary", run: { id: "2026110900", date: "20261109", hour: 0, startedAt: "2026-11-09T00:00:00Z" },
  step: 3, width: 360, height: 181, firstLatitude: 90, firstLongitude: 0, increment: 1,
  waveHeight: new Float32Array(size).fill(1.8), wavePeriod: new Float32Array(size).fill(11), waveDirection: new Float32Array(size).fill(180) };
// A masked area in the northwest of the test view must not grow particle crests.
for (let y = 59; y <= 61; y++) for (let x = 119; x <= 121; x++) { wave.waveHeight[y * 360 + x] = NaN; wave.wavePeriod[y * 360 + x] = NaN; wave.waveDirection![y * 360 + x] = NaN; }
const wind = { ...wave, kind: "wind" as const, u: new Float32Array(size).fill(8), v: new Float32Array(size).fill(-4), gust: null };
const spots: SavedSpot[] = Array.from({ length: 24 }, (_, index) => ({ id: `spot-${index}`, name: `Marker ${index}`,
  point: { latitude: 26.1 + index * .025, longitude: 127.1 + index * .025 }, startYear: 2025, endYear: 2025,
  criteria: { ...defaultHistoryCriteria, conditions: index % 2 ? "wind" : "swell" }, linkedSpotIds: index < 23 ? [`spot-${index + 1}`] : [], alertEnabled: false, alertMinDays: 1 }));
map.map.setView([26.4, 127.4], 8, { animate: false });
map.setSavedSpots(spots);
const point = { latitude: 26.5, longitude: 127.7 };
const setFlag = (direction: number | null = 180) => {
  wave.waveDirection!.fill(direction === null ? NaN : direction);
  render(flagView({ ...initialState, phase: "ready", layer: "waves", field: wave, run: wave.run, step: 3, selected: point }, () => {}), flag);
  map.select(point);
};
setFlag();
const api = {
  ready: true, webgl: !!map.maplibre,
  setLayer(layer: "waves" | "wind" | null) { renderer.setField(layer === "waves" ? wave : layer === "wind" ? wind : null); },
  setView(latitude: number, longitude: number, zoom: number) { map.map.setView([latitude, longitude], zoom, { animate: false }); renderer.redraw(); },
  setDirection(from: number) { wave.waveDirection!.fill(from); renderer.setField(wave); },
  setFlag,
  panBy(x: number, y: number) { map.map.panBy([x, y], { animate: false }); },
  flagAt(x: number, y: number) {
    const point = map.pointAt({ x, y });
    map.select(point);
  },
  alignments() { return spots.map((spot, index) => {
    const node = document.querySelectorAll<HTMLElement>(".saved-spot-icon")[index]!;
    const box = node.getBoundingClientRect(), expected = map.screenPoint(spot.point), rect = element.getBoundingClientRect();
    return { index, position: getComputedStyle(node).position, dx: box.left + 17 - rect.left - expected.x,
      dy: box.top + 35 - rect.top - expected.y, point: spot.point };
  }); },
};
Object.assign(window, { mapVisual: api });
api.setLayer("waves");

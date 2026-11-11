import * as L from "leaflet";

type DistanceTool = Readonly<{
  isDrawing: () => boolean;
  addPoint: (point: L.LatLng) => void;
}>;

const svgElement = <K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] =>
  document.createElementNS("http://www.w3.org/2000/svg", name);

const distanceLabel = (metres: number): string => metres < 10 ? `${metres.toFixed(1)} m`
  : metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`;

/** A temporary map measurement. Its points are geographic; zoom only changes their screen positions. */
export const createDistanceTool = (map: L.Map): DistanceTool => {
  let drawing = false;
  let points: L.LatLng[] = [];
  let hover: L.LatLng | null = null;

  const overlay = svgElement("svg");
  overlay.classList.add("distance-overlay");
  overlay.setAttribute("aria-hidden", "true");
  const halo = svgElement("path"), line = svgElement("path"), preview = svgElement("path"), dots = svgElement("g");
  halo.classList.add("distance-line-halo");
  line.classList.add("distance-line");
  preview.classList.add("distance-line-preview");
  overlay.append(halo, line, preview, dots);
  map.getContainer().parentElement?.append(overlay);

  const control = document.createElement("div");
  control.className = "distance-control";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "distance-toggle";
  toggle.setAttribute("aria-label", "Measure distance");
  toggle.setAttribute("aria-pressed", "false");
  toggle.textContent = "Measure";
  const panel = document.createElement("section");
  panel.className = "distance-panel";
  panel.setAttribute("aria-label", "Distance measurement");
  panel.hidden = true;
  const heading = document.createElement("strong");
  heading.textContent = "Distance";
  const result = document.createElement("output");
  result.className = "distance-result";
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");
  const hint = document.createElement("p");
  hint.className = "distance-hint";
  const actions = document.createElement("div");
  actions.className = "distance-actions";
  const action = (label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    actions.append(button);
    return button;
  };
  const center = action("Add centre"), undo = action("Undo"), clear = action("Clear"), close = action("Close");
  panel.append(heading, result, hint, actions);
  control.append(toggle, panel);
  L.DomEvent.disableClickPropagation(control);
  L.DomEvent.disableScrollPropagation(control);
  map.getContainer().parentElement?.append(control);

  const total = (): number => points.slice(1).reduce((sum, point, index) => sum + map.distance(points[index]!, point), 0);
  const project = (point: L.LatLng): L.Point => {
    const longitude = point.lng + Math.round((map.getCenter().lng - point.lng) / 360) * 360;
    return map.latLngToContainerPoint([point.lat, longitude]);
  };
  const redraw = (): void => {
    const size = map.getSize();
    overlay.setAttribute("viewBox", `0 0 ${size.x} ${size.y}`);
    const positions = points.map(project);
    const route = positions.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
    halo.setAttribute("d", route);
    line.setAttribute("d", route);
    const next = drawing && hover && points.length ? project(hover) : null;
    preview.setAttribute("d", next ? `M${positions.at(-1)!.x} ${positions.at(-1)!.y} L${next.x} ${next.y}` : "");
    dots.replaceChildren(...positions.map((point, index) => {
      const dot = svgElement("circle");
      dot.classList.add(index === 0 ? "distance-start" : "distance-point");
      dot.setAttribute("cx", String(point.x)); dot.setAttribute("cy", String(point.y)); dot.setAttribute("r", "5");
      return dot;
    }));
  };
  const refresh = (): void => {
    panel.hidden = !drawing && points.length === 0;
    toggle.textContent = drawing ? "Done" : points.length ? "Edit line" : "Measure";
    toggle.setAttribute("aria-pressed", String(drawing));
    result.textContent = points.length > 1 ? distanceLabel(total()) : points.length ? "Start point set" : "Ready to measure";
    hint.textContent = drawing ? "Tap the map to add points. Pan or zoom to place them precisely."
      : "The line stays in place as you zoom. Edit to add more points.";
    center.hidden = !drawing;
    undo.disabled = !drawing || points.length === 0;
    clear.disabled = points.length === 0;
    redraw();
  };
  toggle.addEventListener("click", () => { drawing = !drawing; hover = null; refresh(); });
  center.addEventListener("click", () => { if (drawing) { points.push(map.getCenter()); hover = null; refresh(); } });
  undo.addEventListener("click", () => { if (drawing && points.length) { points.pop(); hover = null; refresh(); } });
  clear.addEventListener("click", () => { points = []; hover = null; drawing = true; refresh(); });
  close.addEventListener("click", () => { points = []; hover = null; drawing = false; refresh(); });
  map.on("mousemove", (event: L.LeafletMouseEvent) => { if (drawing && points.length) { hover = event.latlng; redraw(); } });
  map.on("mouseout", () => { if (hover) { hover = null; redraw(); } });
  map.on("move zoom resize", redraw);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !drawing) return;
    drawing = false; hover = null; refresh();
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  refresh();
  return {
    isDrawing: () => drawing,
    addPoint: (point) => { if (drawing) { points.push(point); hover = null; refresh(); } },
  };
};

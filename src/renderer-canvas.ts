import type * as L from "leaflet";
import { sampleWind, type WindField } from "./wind.ts";

type Particle = { x: number; y: number; age: number };
type WindRenderer = Readonly<{
  setField: (field: WindField | null) => void;
  redraw: () => void;
}>;

const STOPS: readonly [number, number, number, number][] = [
  [0, 129, 191, 201],
  [3, 86, 172, 179],
  [7, 68, 190, 139],
  [12, 157, 201, 91],
  [18, 237, 193, 82],
  [25, 227, 128, 78],
  [35, 183, 77, 98],
  [50, 111, 52, 116],
];

export const windColor = (speed: number): readonly [number, number, number] => {
  for (let index = 1; index < STOPS.length; index++) {
    const next = STOPS[index]!;
    if (speed <= next[0]) {
      const prior = STOPS[index - 1]!;
      const t = Math.max(0, (speed - prior[0]) / (next[0] - prior[0]));
      return [1, 2, 3].map((channel) => Math.round(prior[channel]! + (next[channel]! - prior[channel]!) * t)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1]!.slice(1) as [number, number, number];
};

export const createWindRenderer = (map: L.Map, color: HTMLCanvasElement, arrows: HTMLCanvasElement): WindRenderer => {
  const colorContext = color.getContext("2d", { alpha: true });
  const arrowContext = arrows.getContext("2d", { alpha: true });
  if (!colorContext || !arrowContext) throw new Error("Canvas 2D is unavailable");

  let field: WindField | null = null;
  let particles: Particle[] = [];
  let frame = 0;
  let colorFrame = 0;
  let colorRevision = 0;
  let lastFrame = 0;
  let moving = false;
  let zooming = false;
  let paintedView: Readonly<{ center: L.LatLng; zoom: number }> | null = null;
  let arrowsPreviewed = false;
  let previewShift: Readonly<{ x: number; y: number; scale: number }> = { x: 0, y: 0, scale: 1 };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const size = (): { width: number; height: number } => {
    const width = color.clientWidth;
    const height = color.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (arrows.width !== Math.round(width * ratio) || arrows.height !== Math.round(height * ratio)) {
      arrows.width = Math.round(width * ratio);
      arrows.height = Math.round(height * ratio);
    }
    arrowContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height };
  };

  const paintColor = (revision: number): void => {
    colorFrame = 0;
    const { width, height } = size();
    if (!field || width === 0 || height === 0 || moving || zooming) return;
    const paintingField = field;

    const cell = width < 700 ? 5 : 4;
    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    const pixels = colorContext.createImageData(cols, rows);
    const longitudes = Array.from({ length: cols }, (_, x) => map.containerPointToLatLng([x * cell, 0]).lng);
    const latitudes = Array.from({ length: rows }, (_, y) => map.containerPointToLatLng([0, y * cell]).lat);
    let row = 0;
    const paintRows = (): void => {
      colorFrame = 0;
      if (revision !== colorRevision || moving || zooming || paintingField !== field) return;
      const deadline = performance.now() + 7;
      do {
        for (let x = 0; x < cols; x++) {
          const sample = sampleWind(paintingField, latitudes[row]!, longitudes[x]!);
          if (!sample) continue;
          const [red, green, blue] = windColor(sample.speed);
          const offset = (row * cols + x) * 4;
          pixels.data[offset] = red;
          pixels.data[offset + 1] = green;
          pixels.data[offset + 2] = blue;
          pixels.data[offset + 3] = 178;
        }
        row++;
      } while (row < rows && performance.now() < deadline);
      if (row < rows) {
        colorFrame = requestAnimationFrame(paintRows);
        return;
      }
      if (color.width !== cols || color.height !== rows) {
        color.width = cols;
        color.height = rows;
      }
      colorContext.putImageData(pixels, 0, 0);
      paintedView = { center: map.getCenter(), zoom: map.getZoom() };
      color.style.transition = "none";
      color.style.transform = "none";
    };
    paintRows();
  };

  const makeParticle = (width: number, height: number): Particle => ({
    x: Math.random() * width,
    y: Math.random() * height,
    age: Math.random() * 140,
  });

  const drawArrow = (x: number, y: number, dx: number, dy: number, opacity: number): void => {
    const length = 10;
    const nx = dx / Math.hypot(dx, dy);
    const ny = dy / Math.hypot(dx, dy);
    arrowContext.globalAlpha = opacity;
    arrowContext.beginPath();
    arrowContext.moveTo(x - nx * length * 0.5, y - ny * length * 0.5);
    arrowContext.lineTo(x + nx * length * 0.5, y + ny * length * 0.5);
    arrowContext.moveTo(x + nx * length * 0.5, y + ny * length * 0.5);
    arrowContext.lineTo(x + nx * 2 - ny * 3, y + ny * 2 + nx * 3);
    arrowContext.moveTo(x + nx * length * 0.5, y + ny * length * 0.5);
    arrowContext.lineTo(x + nx * 2 + ny * 3, y + ny * 2 - nx * 3);
    arrowContext.stroke();
  };

  const animate = (now: number): void => {
    frame = requestAnimationFrame(animate);
    if (moving || zooming) { lastFrame = now; return; }
    const { width, height } = size();
    if (arrowsPreviewed) {
      if (Math.abs(previewShift.scale - 1) < 0.000001) {
        for (const particle of particles) {
          particle.x += previewShift.x;
          particle.y += previewShift.y;
        }
      } else particles = [];
      arrows.style.transition = "none";
      arrows.style.transform = "none";
      arrowsPreviewed = false;
      previewShift = { x: 0, y: 0, scale: 1 };
    }
    arrowContext.clearRect(0, 0, width, height);
    if (!field || document.hidden || width === 0 || height === 0) return;
    const delta = Math.min((now - (lastFrame || now)) / 16.7, 2);
    lastFrame = now;
    const target = Math.min(650, Math.max(180, Math.round(width * height / 1900)));
    while (particles.length < target) particles.push(makeParticle(width, height));
    if (particles.length > target) particles = particles.slice(0, target);
    arrowContext.lineWidth = 1.35;
    arrowContext.lineCap = "round";
    arrowContext.lineJoin = "round";
    arrowContext.strokeStyle = "#ffffff";
    arrowContext.shadowColor = "rgba(5, 29, 43, .75)";
    arrowContext.shadowBlur = 3;

    for (const particle of particles) {
      const location = map.containerPointToLatLng([particle.x, particle.y]);
      const wind = sampleWind(field, location.lat, location.lng);
      if (!wind || wind.speed < 0.3 || particle.age > 190 || particle.x < -10 || particle.x > width + 10 || particle.y < -10 || particle.y > height + 10) {
        Object.assign(particle, makeParticle(width, height));
        continue;
      }
      const distance = reducedMotion.matches ? 0 : Math.min(3, Math.max(0.45, wind.speed * 0.13)) * delta;
      const dx = wind.u / wind.speed;
      const dy = -wind.v / wind.speed;
      particle.x += dx * distance;
      particle.y += dy * distance;
      if (!reducedMotion.matches) particle.age += delta;
      drawArrow(particle.x, particle.y, dx, dy, reducedMotion.matches ? 0.75 : Math.min(0.86, (190 - particle.age) / 65));
    }
    arrowContext.globalAlpha = 1;
  };

  const cancelColor = (): void => {
    colorRevision++;
    if (colorFrame) cancelAnimationFrame(colorFrame);
    colorFrame = 0;
  };
  const requestColor = (): void => {
    cancelColor();
    const revision = colorRevision;
    if (!field || moving || zooming) return;
    colorFrame = requestAnimationFrame(() => paintColor(revision));
  };
  const preview = (center: L.LatLng, zoom: number, animated: boolean): void => {
    if (!paintedView) return;
    const viewport = map.getSize();
    const scale = map.getZoomScale(zoom, paintedView.zoom);
    const longitude = center.lng + Math.round((paintedView.center.lng - center.lng) / 360) * 360;
    const prior = map.project(paintedView.center, zoom);
    const next = map.project([center.lat, longitude], zoom);
    const dx = viewport.x * (1 - scale) / 2 + prior.x - next.x;
    const dy = viewport.y * (1 - scale) / 2 + prior.y - next.y;
    const transition = animated ? "transform 250ms cubic-bezier(0, 0, .25, 1)" : "none";
    const transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
    for (const canvas of [color, arrows]) {
      canvas.style.transition = transition;
      canvas.style.transform = transform;
    }
    previewShift = { x: dx, y: dy, scale };
    arrowsPreviewed = true;
  };
  const startMove = (): void => { moving = true; arrowsPreviewed = true; previewShift = { x: 0, y: 0, scale: 1 }; cancelColor(); };
  const finishMove = (): void => {
    moving = false;
    if (!zooming) requestColor();
  };
  map.on("movestart", startMove);
  map.on("zoomstart", () => { zooming = true; cancelColor(); });
  map.on("move", () => preview(map.getCenter(), map.getZoom(), false));
  map.on("zoomanim", (event) => preview(event.center, event.zoom, true));
  map.on("moveend", finishMove);
  map.on("zoomend", () => { zooming = false; if (!moving) requestColor(); });
  map.on("resize", requestColor);
  frame = requestAnimationFrame(animate);

  return {
    setField: (next) => {
      field = next;
      particles = [];
      if (next === null) {
        cancelColor();
        paintedView = null;
        color.style.transition = "none";
        color.style.transform = "none";
        arrows.style.transition = "none";
        arrows.style.transform = "none";
        arrowsPreviewed = false;
        colorContext.clearRect(0, 0, color.width, color.height);
        arrowContext.clearRect(0, 0, arrows.clientWidth, arrows.clientHeight);
      } else requestColor();
    },
    redraw: requestColor,
  };
};

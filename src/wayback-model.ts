import type { Point } from "./model.ts";
import { waybackZoom, type WaybackCapture, type WaybackData, type WaybackResult } from "./wayback.ts";

export type WaybackPanel = Readonly<{
  available: boolean; center: Point; zoom: number; point: Point | null; request: number;
  phase: "idle" | "needsData" | "loading" | "ready" | "failed";
  data: WaybackData | null; release: number | null; message: string | null;
}>;
export type WaybackProposal =
  | Readonly<{ kind: "imageryViewportChanged"; center: Point; zoom: number }>
  | Readonly<{ kind: "waybackRetry" }>
  | Readonly<{ kind: "waybackStarted"; request: number }>
  | Readonly<{ kind: "waybackCompleted"; request: number; result: WaybackResult }>
  | Readonly<{ kind: "waybackCaptureSelected"; release: number }>
  | Readonly<{ kind: "waybackTilesFailed" }>;
export type WaybackEffect = Readonly<{ kind: "loadWayback"; point: Point; zoom: number; request: number }>;
export const initialWayback: WaybackPanel = {
  available: false, center: { latitude: 28, longitude: 0 }, zoom: 2, point: null, request: 0,
  phase: "idle", data: null, release: null, message: null,
};
const samePoint = (a: Point | null, b: Point): boolean => a?.latitude === b.latitude && a?.longitude === b.longitude;
export const alignWayback = (panel: WaybackPanel, selected: Point | null, active: boolean): WaybackPanel => {
  if (!active || !panel.available) return panel.phase === "loading" || panel.phase === "needsData"
    ? { ...panel, phase: "idle", request: panel.request + 1 } : panel;
  const point = selected ?? panel.center;
  const aligned = samePoint(panel.point, point);
  if (panel.zoom < 10) return panel.phase === "idle" && aligned && !panel.data ? panel
    : { ...panel, point, phase: "idle", data: null, release: null, message: null, request: panel.request + 1 };
  if (aligned && panel.data?.zoom === panel.zoom) return panel;
  if (aligned && ["needsData", "loading", "failed"].includes(panel.phase)) return panel;
  return { ...panel, point, phase: "needsData", data: null, release: null, message: null, request: panel.request + 1 };
};
export const presentWayback = (panel: WaybackPanel, proposal: WaybackProposal): WaybackPanel => {
  switch (proposal.kind) {
    case "imageryViewportChanged": {
      const zoom = waybackZoom(proposal.zoom);
      if (samePoint(panel.center, proposal.center) && panel.zoom === zoom) return panel;
      return { ...panel, center: proposal.center, zoom,
        ...(zoom !== panel.zoom ? { phase: "idle" as const, data: null, release: null, request: panel.request + 1, message: null } : {}) };
    }
    case "waybackRetry": return { ...panel, phase: "idle", data: null, message: null, release: null, request: panel.request + 1 };
    case "waybackStarted": return panel.request === proposal.request && panel.phase === "needsData" ? { ...panel, phase: "loading" } : panel;
    case "waybackCompleted": {
      if (panel.request !== proposal.request || panel.phase !== "loading") return panel;
      if (!proposal.result.ok) return { ...panel, phase: "failed", data: null, release: null, message: proposal.result.message };
      const data = proposal.result.data;
      return { ...panel, phase: "ready", data, release: data.captures[0]?.release ?? null, message: null };
    }
    case "waybackCaptureSelected": return panel.data?.captures.some((capture) => capture.release === proposal.release)
      ? { ...panel, release: proposal.release, message: null } : panel;
    case "waybackTilesFailed": return { ...panel, message: "This archive image could not load. Choose another date or return to Map." };
  }
};
export const selectedCapture = (panel: WaybackPanel): WaybackCapture | null =>
  panel.message || panel.phase !== "ready" ? null : panel.data?.captures.find((capture) => capture.release === panel.release) ?? null;
export const waybackEffect = (panel: WaybackPanel, active: boolean): WaybackEffect | null =>
  active && panel.available && panel.point && panel.zoom >= 10 && panel.phase === "needsData"
    ? { kind: "loadWayback", point: panel.point, zoom: panel.zoom, request: panel.request } : null;

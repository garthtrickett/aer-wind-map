import type { ConditionSource } from "./history.ts";
import type { Point } from "./model.ts";
import type { CompassForecastData, CompassForecastResult } from "./compass-forecast.ts";

export type CompassForecast = Readonly<{
  point: Point | null; source: ConditionSource; mode: "now" | "map"; nowHour: number;
  phase: "idle" | "needsData" | "loading" | "ready" | "failed";
  request: number; data: CompassForecastData | null; checkedAt: number | null;
}>;
export type CompassForecastProposal =
  | Readonly<{ kind: "compassTimeModeChanged"; mode: "now" | "map" }>
  | Readonly<{ kind: "compassForecastRefresh" }>
  | Readonly<{ kind: "compassClockTick"; now: number }>
  | Readonly<{ kind: "compassForecastStarted"; request: number }>
  | Readonly<{ kind: "compassForecastCompleted"; request: number; result: CompassForecastResult; checkedAt: number }>;
export type CompassForecastEffect = Readonly<{ kind: "loadCompassForecast"; point: Point; source: ConditionSource; request: number }>;
export const initialCompassForecast: CompassForecast = {
  point: null, source: "both", mode: "now", nowHour: Math.floor(Date.now() / 3600000) * 3600,
  phase: "idle", request: 0, data: null, checkedAt: null,
};
export const alignCompassForecast = (panel: CompassForecast, point: Point | null, source: ConditionSource): CompassForecast => {
  if (panel.point?.latitude === point?.latitude && panel.point?.longitude === point?.longitude && panel.source === source) return panel;
  return { ...panel, point, source, phase: point ? "needsData" : "idle", request: panel.request + 1, data: null, checkedAt: null,
    nowHour: Math.floor(Date.now() / 3600000) * 3600 };
};
export const presentCompassForecast = (panel: CompassForecast, proposal: CompassForecastProposal): CompassForecast => {
  switch (proposal.kind) {
    case "compassTimeModeChanged": return { ...panel, mode: proposal.mode };
    case "compassForecastRefresh": return panel.point ? { ...panel, request: panel.request + 1, phase: "needsData", data: null } : panel;
    case "compassClockTick": {
      const nowHour = Math.floor(proposal.now / 3600000) * 3600;
      const stale = panel.point && panel.checkedAt !== null && proposal.now - panel.checkedAt >= 15 * 60_000 &&
        (panel.phase === "ready" || panel.phase === "failed");
      return stale ? { ...panel, nowHour, request: panel.request + 1, phase: "needsData", data: null }
        : nowHour === panel.nowHour ? panel : { ...panel, nowHour };
    }
    case "compassForecastStarted": return proposal.request === panel.request && panel.phase === "needsData" ? { ...panel, phase: "loading" } : panel;
    case "compassForecastCompleted": return proposal.request !== panel.request || panel.phase !== "loading" ? panel
      : { ...panel, phase: proposal.result.ok ? "ready" : "failed", data: proposal.result.ok ? proposal.result.data : null, checkedAt: proposal.checkedAt };
  }
};
export const compassForecastEffect = (panel: CompassForecast): CompassForecastEffect | null => panel.point && panel.phase === "needsData"
  ? { kind: "loadCompassForecast", point: panel.point, source: panel.source, request: panel.request } : null;

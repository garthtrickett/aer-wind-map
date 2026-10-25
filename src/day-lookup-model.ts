import type { Point } from "./model.ts";
import { validLookupDate, type DayData, type DayResult } from "./day-lookup.ts";

export type DayLookupPanel = Readonly<{
  point: Point | null;
  open: boolean;
  date: string;
  startHour: number;
  endHour: number;
  request: number;
  phase: "idle" | "needsData" | "loading" | "ready" | "failed";
  data: DayData | null;
  message: string | null;
}>;
export type DayLookupProposal =
  | Readonly<{ kind: "dayLookupToggled" }>
  | Readonly<{ kind: "dayLookupDateChanged"; date: string }>
  | Readonly<{ kind: "dayLookupHoursChanged"; start: number; end: number }>
  | Readonly<{ kind: "dayLookupRequested" }>
  | Readonly<{ kind: "dayLookupStarted"; request: number }>
  | Readonly<{ kind: "dayLookupCompleted"; request: number; result: DayResult }>;
export type DayLookupEffect = Readonly<{ kind: "loadDay"; point: Point; date: string; request: number }>;
export const initialDayLookup: DayLookupPanel = {
  point: null, open: false, date: new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10),
  startHour: 6, endHour: 18, request: 0, phase: "idle", data: null, message: null,
};
export const alignDayLookup = (panel: DayLookupPanel, point: Point | null): DayLookupPanel =>
  panel.point?.latitude === point?.latitude && panel.point?.longitude === point?.longitude ? panel
    : { ...panel, point, open: false, request: panel.request + 1, phase: "idle", data: null, message: null };

export const presentDayLookup = (panel: DayLookupPanel, proposal: DayLookupProposal): DayLookupPanel => {
  switch (proposal.kind) {
    case "dayLookupToggled": return { ...panel, open: !panel.open };
    case "dayLookupDateChanged": return { ...panel, date: proposal.date, phase: "idle", data: null, message: null, request: panel.request + 1 };
    case "dayLookupHoursChanged": return Number.isInteger(proposal.start) && Number.isInteger(proposal.end) &&
      proposal.start >= 0 && proposal.end <= 24 && proposal.start < proposal.end
      ? { ...panel, startHour: proposal.start, endHour: proposal.end } : panel;
    case "dayLookupRequested": return validLookupDate(panel.date) && panel.date <= new Date().toISOString().slice(0, 10) && panel.point
      ? { ...panel, phase: "needsData", data: null, message: null, request: panel.request + 1 }
      : { ...panel, phase: "failed", data: null, message: "Choose a valid past date from 2022 onward.", request: panel.request + 1 };
    case "dayLookupStarted": return panel.request === proposal.request && panel.phase === "needsData" ? { ...panel, phase: "loading" } : panel;
    case "dayLookupCompleted": return panel.request !== proposal.request || panel.phase !== "loading" ? panel
      : proposal.result.ok ? { ...panel, phase: "ready", data: proposal.result.data, message: null }
      : { ...panel, phase: "failed", data: null, message: proposal.result.message };
  }
};

export const dayLookupEffect = (panel: DayLookupPanel, visible: boolean): DayLookupEffect | null =>
  visible && panel.open && panel.point && panel.phase === "needsData"
    ? { kind: "loadDay", point: panel.point, date: panel.date, request: panel.request } : null;

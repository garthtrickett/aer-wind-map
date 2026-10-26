export const defaultHistoryMapZoom = 11;
export const minHistoryMapZoom = 6;
export const maxHistoryMapZoom = 20;

export const validHistoryMapZoom = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minHistoryMapZoom && value <= maxHistoryMapZoom;

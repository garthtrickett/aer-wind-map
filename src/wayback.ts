import type { Point } from "./model.ts";
import type { Satellite } from "./satellite.ts";

export type WaybackCapture = Readonly<{
  release: number; released: string; tileUrl: string; captured: string | null;
  provider: string | null; source: string | null; resolution: number | null; metadataFailed: boolean;
}>;
export type WaybackData = Readonly<{ point: Point; zoom: number; captures: readonly WaybackCapture[]; metadataFailures: number }>;
export type WaybackResult = Readonly<{ ok: true; data: WaybackData }> | Readonly<{ ok: false; message: string }>;
type Release = Readonly<{ releaseNum: number; releaseDateLabel: string; itemURL: string }>;
type Metadata = Readonly<{ date: number; provider: string; source: string; resolution: number }>;
export type WaybackClient = Readonly<{
  getWaybackItemsWithLocalChanges: (point: Point, zoom: number, options: { signal: AbortSignal }) => Promise<readonly Release[]>;
  getMetadata: (point: Point, zoom: number, release: number) => Promise<Metadata | null>;
}>;

export const waybackEnabled = (value: string | undefined): boolean => value === "true";
export const waybackZoom = (zoom: number): number => Math.min(19, Math.max(0, Math.floor(zoom)));
const day = (value: number): string | null => Number.isFinite(value) && value >= Date.UTC(1950, 0, 1) && value <= Date.now() + 86400_000
  ? new Date(value).toISOString().slice(0, 10) : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
const validDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && day(Date.parse(value)) === value;

const tileTemplate = (release: Release): string | null => {
  try {
    const url = new URL(release.itemURL);
    if (url.protocol !== "https:" || url.hostname !== "wayback.maptiles.arcgis.com" || url.username || url.password || url.search || url.hash ||
      !Number.isSafeInteger(release.releaseNum) || release.releaseNum <= 0 || !validDay(release.releaseDateLabel) ||
      !decodeURI(url.pathname).endsWith(`/tile/${release.releaseNum}/{level}/{row}/{col}`)) return null;
    return release.itemURL.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}");
  } catch { return null; }
};

// Core's metadata API does not accept a signal. Bound our wait and reject stale
// results; its already-started network requests may still finish in the browser.
const abortable = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason ?? new Error("Aborted"));
  promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  if (signal.aborted) { abort(); return; }
  signal.addEventListener("abort", abort, { once: true });
});

export const uniqueCaptures = (captures: readonly WaybackCapture[]): readonly WaybackCapture[] => {
  const sorted = [...captures].sort((a, b) => b.released.localeCompare(a.released));
  const seen = new Set<string>();
  return sorted.filter((capture) => {
    // Unknown metadata must retain its release identity; a publication date is
    // never substituted for an acquisition date.
    // Provider rebrands (DigitalGlobe/Maxar/Vantor) and changed sampling
    // resolution do not turn the same dated source into a new capture.
    const key = capture.captured ? JSON.stringify([capture.captured, capture.source ?? capture.provider]) : `release:${capture.release}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => (b.captured ?? "").localeCompare(a.captured ?? "") || b.released.localeCompare(a.released));
};

export const loadWayback = async (point: Point, zoom: number, signal: AbortSignal,
  getClient: () => Promise<WaybackClient> = () => import("@esri/wayback-core")): Promise<WaybackResult> => {
  try {
    if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 85.05112878 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
      !Number.isInteger(zoom) || zoom < 10 || zoom > 19) throw new Error("Invalid point or detail level");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    const client = await abortable(getClient(), bounded);
    const releases = await abortable(client.getWaybackItemsWithLocalChanges(point, zoom, { signal: bounded }), bounded);
    if (!Array.isArray(releases) || releases.length > 500) throw new Error("Invalid release catalogue");
    const captures: WaybackCapture[] = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, releases.length) }, async () => {
      while (cursor < releases.length) {
        bounded.throwIfAborted();
        const release = releases[cursor++];
        const tileUrl = tileTemplate(release);
        if (!tileUrl) throw new Error("Invalid imagery URL");
        let metadata: Metadata | null = null, metadataFailed = false;
        try { metadata = await abortable(client.getMetadata(point, zoom, release.releaseNum), AbortSignal.any([bounded, AbortSignal.timeout(10_000)])); }
        catch { bounded.throwIfAborted(); metadataFailed = true; }
        captures.push({ release: release.releaseNum, released: release.releaseDateLabel, tileUrl,
          captured: metadata && typeof metadata.date === "number" ? day(metadata.date) : null,
          provider: text(metadata?.provider), source: text(metadata?.source),
          resolution: typeof metadata?.resolution === "number" && Number.isFinite(metadata.resolution) && metadata.resolution > 0 ? metadata.resolution : null,
          metadataFailed });
      }
    }));
    return { ok: true, data: { point, zoom, captures: uniqueCaptures(captures), metadataFailures: captures.filter((capture) => capture.metadataFailed).length } };
  } catch {
    return { ok: false, message: "Imagery history could not load. Try again or choose a nearby point." };
  }
};

export const waybackImagery = (capture: WaybackCapture): Satellite => ({
  provider: "esri", tiles: [capture.tileUrl], minZoom: 0, maxZoom: 19, tileSize: 256,
  attribution: ["Esri", capture.provider, capture.source, "Earthstar Geographics", "GIS User Community"].filter(Boolean).join(" · "),
});

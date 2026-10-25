export type Basemap = "map" | "satellite";
export type Satellite = Readonly<{ tiles: readonly string[]; attribution: string; minZoom: number; maxZoom: number; tileSize: number }>;
export type SatelliteResult = Readonly<{ ok: true; data: Satellite }> | Readonly<{ ok: false; message: string }>;

export const mapTilerTileJson = (key: string | undefined): string | null => key?.trim()
  ? `https://api.maptiler.com/tiles/satellite-v4/tiles.json?${new URLSearchParams({ key: key.trim() })}` : null;

export const loadSatellite = async (url: string, fetcher: typeof fetch = fetch): Promise<SatelliteResult> => {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { ok: false, message: "Satellite is unavailable. Map view restored; try again." };
    const data = await response.json();
    const zoom = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24;
    if (!data || !Array.isArray(data.tiles) || !data.tiles.length || data.tiles.length > 8 ||
      !data.tiles.every((tile: unknown) => {
        if (typeof tile !== "string" || !["{z}", "{x}", "{y}"].every((field) => tile.includes(field))) return false;
        const parsed = new URL(tile);
        return parsed.protocol === "https:" && parsed.hostname === "api.maptiler.com" && !parsed.username && !parsed.password;
      }) || !zoom(data.minzoom) || !zoom(data.maxzoom) || data.minzoom > data.maxzoom ||
      typeof data.attribution !== "string" || data.attribution.length > 8000 ||
      (data.tileSize !== undefined && ![256, 512].includes(data.tileSize))) throw new Error("Invalid satellite metadata");
    return { ok: true, data: { tiles: data.tiles, attribution: data.attribution,
      minZoom: data.minzoom, maxZoom: data.maxzoom, tileSize: data.tileSize ?? 256 } };
  } catch {
    return { ok: false, message: "Satellite could not load. Map view restored; try again." };
  }
};

import type { Point } from "./model.ts";

export type Place = Readonly<{ name: string; label: string; point: Point; zoom: number }>;
export type PlaceSearchResult = Readonly<{ ok: true; places: readonly Place[] }>
  | Readonly<{ ok: false; message: string }>;

export const validPlaceQuery = (query: string): boolean => query.trim().length >= 2 && query.trim().length <= 120;

const decodePlaces = (data: unknown): readonly Place[] => {
  if (!data || typeof data !== "object" || !("features" in data) || !Array.isArray(data.features)) {
    throw new Error("Invalid place search response");
  }
  const places: Place[] = [];
  for (const feature of data.features.slice(0, 10)) {
    const coordinates = feature?.center;
    if (!Array.isArray(coordinates) || coordinates.length !== 2 ||
      !coordinates.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) ||
      Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 85.05112878 ||
      typeof feature.place_name !== "string" || !feature.place_name.trim() || feature.place_name.length > 800) continue;
    const name = typeof feature.text === "string" && feature.text.trim() ? feature.text.trim().slice(0, 120) : feature.place_name.split(",")[0];
    const point = { latitude: coordinates[1], longitude: coordinates[0] };
    if (places.some((place) => place.label === feature.place_name && place.point.latitude === point.latitude && place.point.longitude === point.longitude)) continue;
    const type = feature.place_type?.[0];
    const zoom = type === "country" ? 5 : type === "region" || type === "subregion" ? 8
      : type === "municipality" || type === "place" ? 12 : 14;
    places.push({ name, label: feature.place_name.trim(), point, zoom });
  }
  return places.slice(0, 5);
};

export const searchPlaces = async (
  query: string, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<PlaceSearchResult> => {
  if (!validPlaceQuery(query)) return { ok: false, message: "Enter a place name between 2 and 120 characters." };
  if (!key.trim()) return { ok: false, message: "Place search is not configured." };
  const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(query.trim())}.json`);
  url.search = new URLSearchParams({ key: key.trim(), limit: "5", language: "en", autocomplete: "false" }).toString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
    if (!response.ok) return { ok: false, message: response.status === 429
      ? "Place search is busy. Wait a moment and try again." : "Place search is unavailable. Try again." };
    return { ok: true, places: decodePlaces(await response.json()) };
  } catch {
    return { ok: false, message: "Place search could not load. Check your connection and try again." };
  }
};

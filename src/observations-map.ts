import * as L from "leaflet";
import type { Observation } from "./observations.ts";

export const createObservationMarkers = (map: L.Map, onSelect: (id: string) => void) => {
  const layer = L.layerGroup().addTo(map);
  let stations: readonly Observation[] = [];
  let showingBuoys = false;
  let showingWind = false;
  const draw = (): void => {
    layer.clearLayers();
    const bounds = map.getBounds(), now = Date.now();
    for (const station of stations) {
      const buoy = showingBuoys && station.kind === "buoy";
      if (!buoy && !(showingWind && station.windSpeed !== null)) continue;
      const longitude = station.longitude + Math.round((map.getCenter().lng - station.longitude) / 360) * 360;
      if (!bounds.contains([station.latitude, longitude])) continue;
      const old = station.observedAt === null || now - Date.parse(station.observedAt) > 3 * 3600_000;
      const label = document.createElement("span");
      label.className = "observation-marker-reading";
      label.textContent = buoy ? station.observedAt === null ? "↶" : station.waveHeight === null ? "≈" : station.waveHeight.toFixed(1)
        : station.windSpeed === null ? "↑" : String(Math.round(station.windSpeed * 3.6));
      const tooltip = document.createElement("span");
      tooltip.textContent = `${station.name} · ${station.observedAt === null ? "wave archive" : buoy ? "wave height (m)" : "wind (km/h)"}${old && station.observedAt ? " · older report" : ""}`;
      L.marker([station.latitude, longitude], {
        icon: L.divIcon({ className: `observation-marker ${buoy ? "buoy-marker" : "wind-marker"}${old ? " observation-stale" : ""}`,
          html: label, iconSize: [36, 36], iconAnchor: [18, 18] }),
        title: station.name, alt: `${station.name} observation`, bubblingMouseEvents: false, zIndexOffset: 500,
      }).bindTooltip(tooltip).on("click", () => onSelect(station.id)).addTo(layer);
    }
  };
  map.on("moveend", draw);
  return {
    update: (next: readonly Observation[], buoys: boolean, wind: boolean): void => {
      stations = next; showingBuoys = buoys; showingWind = wind; draw();
    },
    remove: (): void => { map.off("moveend", draw); layer.remove(); },
  };
};

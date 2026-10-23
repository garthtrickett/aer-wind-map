import assert from "node:assert/strict";
import { forecastSwell, loadForecastAlerts } from "../src/forecast-alerts.ts";
import { defaultHistoryCriteria } from "../src/history.ts";
import type { SavedSpot } from "../src/saved-spots.ts";

// Live upstream acceptance: exercise the same batched loader as Telegram and browser alerts.
const spots: SavedSpot[] = [
  { id: "bali", name: "South Bali", point: { latitude: -8.8, longitude: 115.1 } },
  { id: "taiwan", name: "Jinzun", point: { latitude: 22.95, longitude: 121.3 } },
  { id: "java", name: "South Java", point: { latitude: -8.3, longitude: 112.9 } },
].map((spot) => ({ ...spot, startYear: 2023, endYear: 2025, criteria: defaultHistoryCriteria,
  alertEnabled: true, alertMinDays: 2 }));
const requests: URL[] = [];
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  requests.push(url);
  const response = await fetch(input, init);
  assert.equal(response.status, 200, `${url.hostname} status`);
  return response;
};
const checks = await loadForecastAlerts(spots, new Date(), fetcher);
assert.equal(requests.length, 2, "three locations share one swell and one wind download");
const marine = requests.find((url) => url.hostname.startsWith("marine-"))!;
const wind = requests.find((url) => url.hostname === "api.open-meteo.com")!;
assert.equal(marine.searchParams.get("models"), forecastSwell.model);
assert.equal(marine.searchParams.get("forecast_days"), "10");
assert.equal(wind.searchParams.get("models"), "ecmwf_ifs");
assert.equal(wind.searchParams.get("forecast_days"), "15");
for (const check of checks) {
  assert.ok(check.ok, `${check.id}: ${check.ok ? "" : check.error.kind}`);
  const summary = check.summary;
  assert.ok(summary.availableDays >= 7, `${check.id}: expected at least seven paired daylight days`);
  assert.ok(summary.availableDays <= forecastSwell.days, `${check.id}: no extrapolated swell days`);
  assert.equal(summary.horizonDays, 14, "saved search horizon stays independent of source coverage");
  console.log(JSON.stringify({ spot: check.id, swell: forecastSwell.label, wind: "ECMWF IFS",
    timezone: summary.timezone, availableDays: summary.availableDays, horizonDays: summary.horizonDays,
    lastAvailableDate: summary.availableDates?.at(-1), matchingDays: summary.matchingDays }));
}
console.log("Live MFWAM primary swell + hourly ECMWF wind: all three locations passed.");

import type { ForecastRun } from "./wind.ts";

export type WeatherError =
  | { readonly kind: "network"; readonly detail: string }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "index"; readonly detail: string }
  | { readonly kind: "range"; readonly detail: string }
  | { readonly kind: "decode"; readonly detail: string };

export type RunResult =
  | { readonly ok: true; readonly value: ForecastRun }
  | { readonly ok: false; readonly error: WeatherError };

export const runAt = (instant: Date): ForecastRun => {
  const hour = Math.floor(instant.getUTCHours() / 6) * 6;
  const date = instant.toISOString().slice(0, 10).replaceAll("-", "");
  const hh = String(hour).padStart(2, "0");
  return {
    date,
    hour,
    id: `${date}${hh}`,
    startedAt: `${instant.toISOString().slice(0, 10)}T${hh}:00:00Z`,
  };
};

export const runCandidates = (now: Date): readonly ForecastRun[] =>
  Array.from({ length: 8 }, (_, index) => runAt(new Date(now.getTime() - index * 6 * 3_600_000)))
    .filter((run, index, runs) => runs.findIndex((other) => other.id === run.id) === index);

export const forecastUrl = (run: ForecastRun, step: number, extension: "index" | "grib2"): string => {
  const hh = String(run.hour).padStart(2, "0");
  return `https://storage.googleapis.com/ecmwf-open-data/${run.date}/${hh}z/ifs/0p25/oper/${run.id}0000-${step}h-oper-fc.${extension}`;
};

export const discoverLatest = async (fetcher: typeof fetch = fetch): Promise<RunResult> => {
  for (const run of runCandidates(new Date())) {
    try {
      const response = await fetcher(forecastUrl(run, 72, "index"), { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (response.ok) return { ok: true, value: run };
    } catch {
      // Try an older cycle when this one cannot be reached.
    }
  }
  return { ok: false, error: { kind: "unavailable", detail: "No complete ECMWF forecast run was reachable." } };
};

export const describeWeatherError = (error: WeatherError): string => {
  switch (error.kind) {
    case "network": return "Forecast data could not be reached. Please try again shortly.";
    case "unavailable": return "A complete forecast is temporarily unavailable. Try again shortly.";
    case "index": return "The forecast index could not be read.";
    case "range": return "The forecast field could not be downloaded.";
    case "decode": return "The forecast field could not be decoded on this device.";
  }
};

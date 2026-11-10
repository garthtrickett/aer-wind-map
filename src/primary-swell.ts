import type { RunResult } from "./ecmwf.ts";
import type { ForecastRun } from "./wind.ts";

export const primarySwellSource = "Météo-France MFWAM";
export const primarySwellVariables = ["swell_wave_height", "swell_wave_period", "swell_wave_direction"] as const;
export const primarySwellMetadataUrl = "https://openmeteo.s3.amazonaws.com/data_spatial/meteofrance_wave/latest.json";
export const currentPrimarySwellStep = (run: ForecastRun, now: number): number =>
  Math.max(3, Math.min(72, Math.ceil((now - Date.parse(run.startedAt)) / (3 * 3_600_000)) * 3));

/** Native MFWAM spatial files store propagation (TO) bearings in -180…180°.
 * Open-Meteo's point API and Aer display meteorological FROM bearings.
 */
export const primarySwellDirectionFrom = (towards: number): number =>
  Number.isFinite(towards) && towards >= -180 && towards <= 180 ? (towards + 180) % 360 : NaN;

export const primarySwellFrameUrl = (run: ForecastRun, step: number): string => {
  const reference = new Date(run.startedAt);
  if (!Number.isFinite(reference.getTime()) || !Number.isInteger(step) || step < 0 || step > 240 || step % 3)
    throw new Error("Invalid primary swell forecast time");
  const date = reference.toISOString().slice(0, 10).replaceAll("-", "/");
  const cycle = reference.toISOString().slice(11, 16).replace(":", "");
  const valid = new Date(reference.getTime() + step * 3_600_000).toISOString().slice(0, 16).replace(":", "");
  return `https://openmeteo.s3.amazonaws.com/data_spatial/meteofrance_wave/${date}/${cycle}Z/${valid}.om`;
};

export async function discoverPrimarySwell(fetcher: typeof fetch = fetch): Promise<RunResult> {
  try {
    const response = await fetcher(primarySwellMetadataUrl, { signal: AbortSignal.timeout(15_000), cache: "no-cache" });
    if (!response.ok) throw new Error("Primary swell metadata unavailable");
    const metadata = await response.json() as { completed?: boolean; reference_time?: string; valid_times?: string[]; variables?: string[] };
    const reference = new Date(metadata.reference_time ?? "");
    if (!metadata.completed || !Number.isFinite(reference.getTime()) || reference.getUTCHours() % 12 || reference.getUTCMinutes() ||
      !primarySwellVariables.every((name) => metadata.variables?.includes(name)) ||
      ![0, 3, 72].every((step) => metadata.valid_times?.some((time) => Date.parse(time) === reference.getTime() + step * 3_600_000)))
      throw new Error("Incomplete primary swell run");
    const date = reference.toISOString().slice(0, 10).replaceAll("-", "");
    const hour = reference.getUTCHours();
    return { ok: true, value: { date, hour, id: `${date}${String(hour).padStart(2, "0")}`, startedAt: reference.toISOString() } };
  } catch {
    return { ok: false, error: { kind: "unavailable", detail: "No complete MFWAM primary swell run was reachable." } };
  }
}

/** MFWAM cells are centred on -180 + 1/24°, -80 + 1/24°, ordered south to north.
 * Keep every second native cell for the global map; never average land masks or bearings.
 */
export function primarySwellMapGrid(native: Float32Array, width = 4320, height = 2041): Float32Array {
  if (native.length !== width * height || width % 2 || height % 2 !== 1) throw new Error("Unexpected MFWAM grid");
  const result = new Float32Array(width / 2 * ((height + 1) / 2));
  for (let y = 0; y < (height + 1) / 2; y++) for (let x = 0; x < width / 2; x++)
    result[y * (width / 2) + x] = native[(height - 1 - y * 2) * width + x * 2]!;
  return result;
}

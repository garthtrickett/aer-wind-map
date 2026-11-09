import { loadHistoricalSpot, type HistoricalData, type HistoryResult, type ConditionSource } from "./history.ts";
import type { Point } from "./model.ts";
import type { ArchiveReply, ArchiveProgress, SwellPartition } from "./wave-history-types.ts";

export function joinEcwamHistory(wind: HistoricalData, months: NonNullable<ArchiveReply["months"]>, partition: SwellPartition): HistoricalData {
  const at = new Map(months.flatMap((month) => month.hours.map((hour) => [hour.time, hour] as const)));
  return { ...wind, waveSource: "ecwam", swellPartition: partition,
    waveGrid: months.length ? { latitude: months[0].latitude, longitude: months[0].longitude } : wind.waveGrid,
    hours: wind.hours.map((hour) => {
      const both = at.get(hour.time), reading = both?.[partition];
      return { ...hour, swellHeight: reading?.height ?? null, swellPeriod: reading?.period ?? null,
        swellDirection: reading?.direction ?? null, primarySwell: both?.primary, secondarySwell: both?.secondary,
        swellPresent: reading?.height !== null && reading?.height !== undefined ? reading.height > 1e-8 : undefined };
    }) };
}
const pause = (signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", aborted); resolve(); };
  const aborted = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
  const timer = setTimeout(done, 15_000);
  signal.addEventListener("abort", aborted, { once: true });
  if (signal.aborted) aborted();
});
export async function loadEcwamHistory(options: Readonly<{
  point: Point; startYear: number; endYear: number; conditions: ConditionSource; partition: SwellPartition;
  prepare: boolean; signal: AbortSignal; fetcher?: typeof fetch;
  progress: (value: ArchiveProgress, data: HistoricalData | null) => void;
}>): Promise<HistoryResult> {
  const { point, startYear, endYear, signal, partition, prepare } = options;
  const fetcher = options.fetcher ?? fetch;
  const query = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), startYear: String(startYear), endYear: String(endYear) });
  const endpoint = `/api/wave-history?${query}`;
  const request = async (method: string, data = false): Promise<ArchiveReply> => {
    const response = await fetcher(`${endpoint}${data ? "&data=1" : ""}`, { method, signal, credentials: "same-origin" });
    const value = await response.json() as ArchiveReply & { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Archive HTTP ${response.status}`);
    if (!value.progress || !Number.isInteger(value.progress.total) || !Number.isInteger(value.progress.ready) || (data && !Array.isArray(value.months)))
      throw new Error("Invalid archive response");
    return value;
  };
  try {
    let status = await request(prepare ? "POST" : "GET");
    options.progress(status.progress, null);
    // Retain Aer’s established local-time and historical wind series. UTC timestamps join the sources.
    const wind = await loadHistoricalSpot({ point, startYear, endYear, conditions: "wind", fetcher: (input, init) => fetcher(input,
      { ...init, signal: AbortSignal.any([signal, init?.signal ?? AbortSignal.timeout(45_000)]) }) });
    if (!wind.ok) return wind;
    let ready = -1, data = joinEcwamHistory(wind.value, [], partition);
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (status.progress.ready !== ready) {
        const reply = await request("GET", true);
        data = joinEcwamHistory(wind.value, reply.months ?? [], partition);
        status = reply; ready = reply.progress.ready;
      }
      options.progress(status.progress, data);
      if (!status.progress.pending) return { ok: true, value: data };
      await pause(signal);
      status = await request("GET");
    }
  } catch (error) {
    return { ok: false, error: { kind: "unavailable", detail: signal.aborted ? "Archive view closed." : error instanceof Error ? error.message : "Archive history unavailable." } };
  }
}

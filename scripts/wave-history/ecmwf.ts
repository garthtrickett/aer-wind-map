import type { Job, WaveStore } from "./store.ts";
import { decodeEcwam } from "./netcdf.ts";

export type EcmwfCredentials = Readonly<{ email: string; key: string }>;
const base = "https://api.ecmwf.int/v1/";
function providerUrl(value: string): string {
  const url = new URL(value, base);
  if (url.origin !== "https://api.ecmwf.int" || !url.pathname.startsWith("/v1/datasets/research/requests/"))
    throw new Error("Unexpected ECMWF request location");
  return url.href;
}
export const marsRequest = (job: Job) => {
  const last = new Date(Date.UTC(job.year, job.month, 0)).getUTCDate();
  const day = `${job.year}${String(job.month).padStart(2, "0")}`;
  // Small 3x3 output box, snapped to the native-resolution regular output grid.
  const north = Math.min(90, job.latitude + 0.125), south = Math.max(-90, job.latitude - 0.125);
  const west = job.longitude - 0.125, east = job.longitude + 0.125;
  return { class: "rd", dataset: "research", expver: job.year <= 2023 ? "ijxo" : "iocj",
    date: `${day}01/to/${day}${String(last).padStart(2, "0")}/by/1`, levtype: "sfc",
    param: "140121/140122/140123/140124/140125/140126", step: "0", stream: "wave",
    time: "0/to/23/by/1", type: "an", area: `${north}/${west}/${south}/${east}`,
    grid: "0.125/0.125", format: "netcdf" };
};
class TemporaryProviderError extends Error {}
export async function advanceJob(store: WaveStore, job: Job, credentials: EcmwfCredentials, signal: AbortSignal, fetcher = fetch): Promise<void> {
  const api = async (url: string, method = "GET", body?: unknown): Promise<{ response: Response; value: Record<string, unknown> }> => {
    let response: Response;
    try {
      response = await fetcher(url, { method, redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
        headers: { Accept: "application/json", From: credentials.email, "X-ECMWF-KEY": credentials.key,
          ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new TemporaryProviderError("ECMWF could not be reached; the saved request will be checked again."); }
    if (response.status === 429 || response.status >= 500) throw new TemporaryProviderError("ECMWF is busy; the saved request will be checked again.");
    if (response.status < 200 || response.status >= 400) throw new Error(`ECMWF request returned HTTP ${response.status}. Check server credentials and archive access.`);
    const value = await response.json() as Record<string, unknown>;
    if (value.error) throw new Error("ECMWF rejected this archive request. Check the request in the ECMWF account before retrying.");
    return { response, value };
  };
  let provider = job.provider;
  try {
    if (job.state === "queued") {
      store.update(job.key, "submitting", null);
      // Never automatically retry POST: a network failure may happen after ECMWF accepted it.
      const { response } = await api(`${base}datasets/research/requests`, "POST", marsRequest(job));
      const location = response.headers.get("Location");
      if (!location) throw new Error("ECMWF accepted no resumable request receipt. Check the ECMWF account before retrying.");
      provider = providerUrl(location);
      store.update(job.key, "polling", provider);
      return;
    }
    if (!provider) throw new Error("The saved ECMWF request receipt is missing.");
    provider = providerUrl(provider);
    const { response: polled, value } = await api(provider);
    if (value.status !== "complete" && polled.status !== 303) {
      if (["aborted", "failed", "error"].includes(String(value.status))) throw new Error("ECMWF archive retrieval failed. Check the request in the ECMWF account.");
      store.update(job.key, "polling", provider);
      return;
    }
    const result = (value.result ?? value) as { href?: unknown; size?: unknown };
    if (typeof result.href !== "string") throw new Error("ECMWF completed without a download URL.");
    const download = new URL(result.href);
    if (download.protocol !== "https:" || download.hostname !== "apps.ecmwf.int" || !download.pathname.startsWith("/api/streaming/"))
      throw new Error("Unexpected ECMWF download location");
    store.update(job.key, "downloading", provider);
    // Download without forwarding the account key to another host.
    const response = await fetcher(download, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    if (!response.ok || !response.body) throw new TemporaryProviderError("ECMWF download unavailable; the saved request will be checked again.");
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error("ECMWF download exceeded the small-area size limit"); }
      chunks.push(chunk);
    }
    if (typeof result.size === "number" && size !== result.size) throw new TemporaryProviderError("ECMWF download was incomplete; it will be tried again.");
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const month = decodeEcwam(bytes, job.year, job.month, job.latitude, job.longitude);
    store.complete(job.key, month);
    await api(provider, "DELETE").catch(() => {}); // Cache committed before releasing the upstream result.
  } catch (error) {
    if (signal.aborted && provider) return; // Resume the same provider request on restart.
    const state = store.get(job.key)?.state;
    if (error instanceof TemporaryProviderError && provider && state !== "submitting") {
      store.update(job.key, "polling", provider, error.message);
    } else {
      store.update(job.key, "failed", provider, error instanceof TemporaryProviderError
        ? "Submission outcome is uncertain. Check ECMWF requests before retrying; no duplicate has been submitted."
        : error instanceof Error ? error.message : "Archive retrieval failed.");
    }
  }
}

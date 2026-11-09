/** Bounded operator utility. Credentials stay in a private JSON file outside the repository. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openWaveStore, monthKeys } from "./store.ts";
import { advanceJob } from "./ecmwf.ts";
const [configPath, dbPath, latitude, longitude, year, month] = process.argv.slice(2);
if (!configPath || !dbPath || ![latitude, longitude, year, month].every((v) => v !== undefined && Number.isFinite(Number(v))))
  throw new Error("Usage: prepare-month.ts PRIVATE_CONFIG ABSOLUTE_DB LAT LON YEAR MONTH");
const config = JSON.parse(readFileSync(configPath, "utf8")) as { email: string; key: string };
if (!config.email || !config.key) throw new Error("Missing registered ECMWF credentials");
const keys = monthKeys(Number(latitude), Number(longitude), Number(year), Number(year))
  .filter((key) => key.year === Number(year) && key.month === Number(month));
if (keys.length !== 1) throw new Error("Choose one published month in 2019–2025");
const store = openWaveStore(resolve(dbPath));
store.enqueue(keys, "operator-validation");
const signal = AbortSignal.timeout(90 * 60_000);
try {
  while (!signal.aborted) {
    const job = store.get(keys[0].key)!;
    console.log(new Date().toISOString(), keys[0].key, job.state);
    if (job.state === "ready") break;
    if (job.state === "failed") throw new Error(job.error ?? "Archive job failed");
    await advanceJob(store, job, config, signal);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  if (signal.aborted) throw new Error("Bounded validation stopped after 90 minutes; provider receipt retained for resumption");
} finally { store.close(); }

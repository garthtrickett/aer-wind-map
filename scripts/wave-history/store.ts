import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { ArchiveProgress, EcwamMonth } from "../../src/wave-history-types.ts";

export type MonthKey = Readonly<{ key: string; latitude: number; longitude: number; year: number; month: number }>;
export type Job = MonthKey & { state: string; provider: string | null; result: string | null; error: string | null; updated: number };
export function monthKeys(latitude: number, longitude: number, start: number, end: number): MonthKey[] {
  const lat = Math.round(latitude * 8) / 8, lon = ((Math.round(longitude * 8) / 8 + 540) % 360) - 180;
  const keys: MonthKey[] = [];
  // One boundary month on each side allows local calendar dates to join correctly across UTC.
  for (let time = Date.UTC(start, -1); time <= Date.UTC(end + 1, 0); time = Date.UTC(new Date(time).getUTCFullYear(), new Date(time).getUTCMonth() + 1)) {
    const date = new Date(time), year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
    if (year < 2019 || year > 2025) continue;
    keys.push({ key: `cy50r1-v1:${lat}:${lon}:${year}:${month}`, latitude: lat, longitude: lon, year, month });
  }
  return keys;
}
export function openWaveStore(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS months(key TEXT PRIMARY KEY, latitude REAL NOT NULL, longitude REAL NOT NULL,
      year INTEGER NOT NULL, month INTEGER NOT NULL, state TEXT NOT NULL, provider TEXT, result TEXT, error TEXT, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(owner TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS worker(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);`);
  const get = (key: string) => db.prepare("SELECT * FROM months WHERE key=?").get(key) as Job | undefined;
  return {
    get,
    claim(owner: string, now = Date.now()): Job | undefined {
      db.exec("BEGIN IMMEDIATE");
      try {
        const lease = db.prepare("SELECT owner,expires FROM worker WHERE id=1").get() as { owner: string; expires: number } | undefined;
        if (lease && lease.owner !== owner && lease.expires > now) { db.exec("COMMIT"); return undefined; }
        if (!lease || lease.owner !== owner) db.prepare("UPDATE months SET state='failed',error=? WHERE state='submitting'")
          .run("Submission was interrupted before a provider receipt was saved. Check ECMWF requests before retrying.");
        db.prepare("INSERT INTO worker(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires")
          .run(owner, now + 240_000);
        const job = db.prepare("SELECT * FROM months WHERE state IN ('queued','polling','downloading') ORDER BY CASE WHEN state='queued' THEN 1 ELSE 0 END, updated LIMIT 1").get() as Job | undefined;
        db.exec("COMMIT"); return job;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    release(owner: string) { db.prepare("DELETE FROM worker WHERE owner=?").run(owner); },
    jobs: () => db.prepare("SELECT * FROM months WHERE state IN ('queued','polling','downloading') ORDER BY CASE WHEN state='queued' THEN 1 ELSE 0 END, updated LIMIT 1").get() as Job | undefined,
    progress(keys: readonly MonthKey[], configured: boolean): ArchiveProgress {
      const rows = keys.map((item) => get(item.key));
      return { configured, total: keys.length, ready: rows.filter((r) => r?.state === "ready").length,
        pending: rows.filter((r) => r && ["queued", "submitting", "polling", "downloading"].includes(r.state)).length,
        failed: rows.filter((r) => r?.state === "failed").length, missing: rows.filter((r) => !r).length,
        active: rows.find((r) => r && ["submitting", "polling", "downloading"].includes(r.state))?.key ?? null,
        error: rows.find((r) => r?.error)?.error ?? null };
    },
    months: (keys: readonly MonthKey[]): EcwamMonth[] => keys.flatMap((item) => {
      const row = get(item.key); return row?.state === "ready" && row.result ? [JSON.parse(row.result) as EcwamMonth] : [];
    }),
    enqueue(keys: readonly MonthKey[], owner: string) {
      const missing = keys.filter((key) => !get(key.key));
      if (!missing.length) return;
      const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM months WHERE state NOT IN ('ready','failed')").get()!.n);
      const recent = Number(db.prepare("SELECT COUNT(*) AS n FROM requests WHERE owner=? AND created>?").get(owner, Date.now() - 86_400_000)!.n);
      if (pending + missing.length > 128) throw new Error("The archive queue is full. Try again after the current downloads finish.");
      if (recent + missing.length > 64) throw new Error("Daily archive preparation limit reached. Cached history is still available.");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const item of missing) {
          db.prepare("INSERT INTO months(key,latitude,longitude,year,month,state,updated) VALUES (?,?,?,?,?,'queued',?)")
            .run(item.key, item.latitude, item.longitude, item.year, item.month, Date.now());
          db.prepare("INSERT INTO requests(owner,created) VALUES (?,?)").run(owner, Date.now());
        }
        db.prepare("DELETE FROM requests WHERE created<?").run(Date.now() - 86_400_000);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    update(key: string, state: string, provider: string | null, error: string | null = null) {
      db.prepare("UPDATE months SET state=?,provider=?,error=?,updated=? WHERE key=?").run(state, provider, error, Date.now(), key);
    },
    complete(key: string, month: EcwamMonth) {
      db.prepare("UPDATE months SET state='ready',result=?,error=NULL,updated=? WHERE key=?").run(JSON.stringify(month), Date.now(), key);
    },
    close() { db.close(); },
  };
}
export type WaveStore = ReturnType<typeof openWaveStore>;

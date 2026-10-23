import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { forecastAlertKey, type ForecastAlertSummary } from "../../src/forecast-alerts.ts";
import type { SavedSpot } from "../../src/saved-spots.ts";
import { disconnectedTelegram, type TelegramStatus } from "../../src/telegram-types.ts";
import type { TelegramSend, TelegramUpdate } from "./telegram.ts";

export const secret = (): string => randomBytes(32).toString("base64url");
export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
export type WatchedSpot = Readonly<{
  owner: string; chatId: number; spot: SavedSpot; config: string;
  qualified: boolean; notifiedDates: readonly string[]; confirmedDates: readonly string[]; notifiedAt: number | null;
}>;
type Owner = { id: string; chat_id: number | null; revision: number; blocked: number };
export type Delivery = Readonly<{
  id: string; owner: string | null; chat_id: number; spot_id: string | null; config: string | null;
  text: string; url: string | null; state: string; attempts: number;
  dates: string | null; confirmation: number; confirmation_dates: string | null;
}>;

export const openAlertStore = (path: string) => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS owners (
      id TEXT PRIMARY KEY, chat_id INTEGER, revision INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS links (
      token TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE REFERENCES owners(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS spots (
      owner TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE, id TEXT NOT NULL, config TEXT NOT NULL,
      next_check INTEGER NOT NULL DEFAULT 0, checked_at INTEGER, error INTEGER NOT NULL DEFAULT 0,
      summary TEXT, qualified INTEGER NOT NULL DEFAULT 0, notified_dates TEXT NOT NULL DEFAULT '[]',
      confirmed_dates TEXT NOT NULL DEFAULT '[]', notified_at INTEGER, PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY, owner TEXT, chat_id INTEGER NOT NULL, spot_id TEXT, config TEXT,
      text TEXT NOT NULL, url TEXT, state TEXT NOT NULL DEFAULT 'queued', next_try INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, sent_at INTEGER,
      dates TEXT, confirmation INTEGER NOT NULL DEFAULT 0, confirmation_dates TEXT);
    CREATE INDEX IF NOT EXISTS delivery_due ON deliveries(state,next_try);
    CREATE TABLE IF NOT EXISTS views (
      token TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
      spot_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta VALUES ('telegram_offset','0');
    CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK(id=1), holder TEXT, expires INTEGER NOT NULL);
    INSERT OR IGNORE INTO worker_lease VALUES (1,NULL,0);
    PRAGMA user_version=1;`);

  const transaction = <T>(action: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = action(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const ownerAt = (id: string): Owner | undefined => db.prepare("SELECT * FROM owners WHERE id=?").get(id) as Owner | undefined;
  const cancel = (owner: string, forecastsOnly = false) => db.prepare(`UPDATE deliveries SET state='cancelled'
    WHERE owner=? AND state IN ('queued','retry'${forecastsOnly ? "" : ",'uncertain','failed'"})${forecastsOnly ? " AND spot_id IS NOT NULL" : ""}`).run(owner);
  const disconnect = (owner: string, blocked = false) => {
    db.prepare("UPDATE owners SET chat_id=NULL, revision=revision+1, blocked=? WHERE id=?").run(Number(blocked), owner);
    db.prepare("DELETE FROM links WHERE owner=?").run(owner);
    db.prepare("DELETE FROM spots WHERE owner=?").run(owner);
    db.prepare("DELETE FROM views WHERE owner=?").run(owner);
    cancel(owner);
  };
  const status = (owner: string | null, now: number): TelegramStatus => {
    const row = owner ? ownerAt(owner) : undefined;
    if (!row) return { ...disconnectedTelegram, available: true };
    const info = db.prepare(`SELECT COUNT(*) AS count, MAX(checked_at) AS checked,
      MAX(error) AS error FROM spots WHERE owner=?`).get(owner!) as { count: number; checked: number | null; error: number };
    const delivery = db.prepare(`SELECT MAX(sent_at) AS sent,
      MAX(CASE WHEN state='uncertain' THEN 2 WHEN state='failed' THEN 1 ELSE 0 END) AS problem
      FROM deliveries WHERE owner=? AND state != 'cancelled'`).get(owner!) as { sent: number | null; problem: number };
    const pending = db.prepare("SELECT 1 FROM links WHERE owner=? AND expires_at>?").get(owner!, now);
    return { available: true, connected: row.chat_id !== null, pending: !!pending, revision: row.revision,
      spotCount: info.count, lastCheckedAt: info.checked, lastSentAt: delivery.sent,
      issue: row.blocked ? "blocked" : delivery.problem === 2 ? "uncertain" : delivery.problem === 1 ? "delivery" : info.error ? "forecast" : null };
  };
  const enqueue = (delivery: { id: string; owner: string | null; chatId: number; text: string; url?: string;
    spotId?: string; config?: string; dates?: readonly string[]; confirmation?: boolean; confirmedDates?: readonly string[] }, now: number) => {
    db.prepare(`INSERT OR IGNORE INTO deliveries(id,owner,chat_id,spot_id,config,text,url,next_try,created_at,dates,confirmation,confirmation_dates)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(delivery.id, delivery.owner, delivery.chatId, delivery.spotId ?? null,
      delivery.config ?? null, delivery.text, delivery.url ?? null, now, now,
      delivery.dates ? JSON.stringify(delivery.dates) : null, Number(delivery.confirmation ?? false),
      delivery.confirmedDates ? JSON.stringify(delivery.confirmedDates) : null);
  };

  return {
    close: () => db.close(),
    status,
    hasOwner: (owner: string): boolean => !!ownerAt(owner),
    beginLink(owner: string | null, now: number): { cookie: string | null; token: string } {
      return transaction(() => {
        let cookie: string | null = null;
        if (!owner || !ownerAt(owner)) {
          // Abandoned, unlinked installations can be reclaimed; connected
          // monitors remain until explicitly disconnected.
          db.prepare("DELETE FROM owners WHERE chat_id IS NULL AND created_at<?").run(now - 86_400_000);
          if ((db.prepare("SELECT COUNT(*) AS n FROM owners").get() as { n: number }).n >= 1000) throw new Error("capacity");
          cookie = secret(); owner = digest(cookie);
          db.prepare("INSERT INTO owners(id,created_at) VALUES (?,?)").run(owner, now);
        }
        if (ownerAt(owner)!.chat_id !== null) throw new Error("already_connected");
        const token = secret();
        db.prepare("DELETE FROM links WHERE expires_at<=? OR owner=?").run(now, owner);
        db.prepare("INSERT INTO links VALUES (?,?,?)").run(digest(token), owner, now + 600_000);
        return { cookie, token };
      });
    },
    sync(owner: string, spots: readonly SavedSpot[], revision: number): boolean {
      return transaction(() => {
        const row = ownerAt(owner);
        if (!row || row.chat_id === null || row.revision !== revision) return false;
        const existing = db.prepare("SELECT id,config FROM spots WHERE owner=?").all(owner) as { id: string; config: string }[];
        for (const old of existing) if (!spots.some((spot) => spot.id === old.id))
          db.prepare("DELETE FROM spots WHERE owner=? AND id=?").run(owner, old.id);
        for (const spot of spots) {
          const config = JSON.stringify(spot);
          const old = existing.find((entry) => entry.id === spot.id);
          if (old?.config === config) continue;
          const rulesChanged = !old || forecastAlertKey(JSON.parse(old.config)) !== forecastAlertKey(spot);
          db.prepare(`INSERT INTO spots(owner,id,config) VALUES (?,?,?) ON CONFLICT(owner,id) DO UPDATE
            SET config=excluded.config,next_check=0,error=0,qualified=CASE WHEN ? THEN 0 ELSE qualified END,
            notified_dates=CASE WHEN ? THEN '[]' ELSE notified_dates END,
            confirmed_dates=CASE WHEN ? THEN '[]' ELSE confirmed_dates END`).run(owner, spot.id, config,
              Number(rulesChanged), Number(rulesChanged), Number(rulesChanged));
        }
        // All unsent messages are re-evaluated against the new snapshot.
        cancel(owner, true);
        db.prepare("UPDATE spots SET next_check=0 WHERE owner=?").run(owner);
        db.prepare("UPDATE owners SET revision=revision+1 WHERE id=?").run(owner);
        return true;
      });
    },
    disconnect(owner: string) { transaction(() => disconnect(owner)); },
    spot(owner: string, id: string): SavedSpot | null {
      const row = db.prepare("SELECT config FROM spots WHERE owner=? AND id=?").get(owner, id) as { config: string } | undefined;
      return row ? JSON.parse(row.config) : null;
    },
    view(token: string, now: number): SavedSpot | null {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const row = db.prepare(`SELECT s.config FROM views v JOIN spots s ON s.owner=v.owner AND s.id=v.spot_id
        JOIN owners o ON o.id=s.owner WHERE v.token=? AND v.expires_at>? AND o.chat_id IS NOT NULL`)
        .get(digest(token), now) as { config: string } | undefined;
      // A view link carries no account control or alert opt-in into a new browser.
      return row ? { ...JSON.parse(row.config), alertEnabled: false } : null;
    },
    offset: (): number => Number((db.prepare("SELECT value FROM meta WHERE key='telegram_offset'").get() as { value: string }).value),
    applyUpdate(update: TelegramUpdate, now: number) {
      transaction(() => {
        const offset = Number((db.prepare("SELECT value FROM meta WHERE key='telegram_offset'").get() as { value: string }).value);
        if (update.update_id < offset) return;
        const message = update.message;
        if (message?.chat.type === "private" && message.from && !message.from.is_bot &&
          message.from.id === message.chat.id && Number.isSafeInteger(message.chat.id) && message.text) {
          const chatId = message.chat.id;
          const [command, token] = message.text.trim().split(/\s+/, 2);
          let reply: string | null = null;
          let linkedOwner: string | null = null;
          if (/^\/start(?:@\w+)?$/.test(command)) {
            const link = token && /^[A-Za-z0-9_-]{43}$/.test(token)
              ? db.prepare("SELECT owner FROM links WHERE token=? AND expires_at>?").get(digest(token), now) as { owner: string } | undefined : undefined;
            if (link) {
              linkedOwner = link.owner;
              db.prepare("UPDATE owners SET chat_id=?,blocked=0 WHERE id=?").run(chatId, link.owner);
              db.prepare("DELETE FROM links WHERE owner=?").run(link.owner);
              reply = "Aer is connected. Return to Saved spots to sync your enabled forecast alerts. /status shows monitoring; /stop stops alerts.";
            } else reply = "Open Aer → Saved spots → Connect Telegram for a fresh connection link. Links expire after 10 minutes.";
          } else if (/^\/stop(?:@\w+)?$/.test(command)) {
            const owners = db.prepare("SELECT id FROM owners WHERE chat_id=?").all(chatId) as { id: string }[];
            owners.forEach((row) => disconnect(row.id));
            // Also cancel older command/test replies addressed to this chat.
            db.prepare("UPDATE deliveries SET state='cancelled' WHERE chat_id=? AND state IN ('queued','retry')").run(chatId);
            reply = "All Aer alerts to this chat are stopped. Reconnect from Saved spots whenever you want.";
          } else if (/^\/status(?:@\w+)?$/.test(command)) {
            const count = (db.prepare(`SELECT COUNT(*) AS n FROM spots s JOIN owners o ON s.owner=o.id WHERE o.chat_id=?`).get(chatId) as { n: number }).n;
            reply = `Aer is monitoring ${count} enabled saved ${count === 1 ? "spot" : "spots"}. Checks run about every 6 hours with the app closed. /stop stops all alerts.`;
          } else if (/^\/help(?:@\w+)?$/.test(command)) reply = "Set conditions in Aer → Find your season, enable the 14-day alert and save. Connect Telegram in Saved spots. /status shows monitoring; /stop stops all alerts. Forecast matches use 06:00–18:00 at the spot, not observed surf conditions.";
          const recent = (db.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE chat_id=? AND created_at>?").get(chatId, now - 60_000) as { n: number }).n;
          if (reply && (recent < 6 || command === "/stop")) enqueue({ id: `update-${update.update_id}`, owner: linkedOwner, chatId, text: reply }, now);
        }
        db.prepare("UPDATE meta SET value=? WHERE key='telegram_offset'").run(String(update.update_id + 1));
      });
    },
    lease(holder: string, now: number): boolean {
      return transaction(() => {
        const row = db.prepare("SELECT holder,expires FROM worker_lease WHERE id=1").get() as { holder: string | null; expires: number };
        if (row.holder !== holder && row.expires > now) return false;
        if (row.holder !== holder) db.prepare("UPDATE deliveries SET state='uncertain' WHERE state='sending'").run();
        db.prepare("UPDATE worker_lease SET holder=?,expires=? WHERE id=1").run(holder, now + 300_000);
        return true;
      });
    },
    release(holder: string) { db.prepare("UPDATE worker_lease SET holder=NULL,expires=0 WHERE holder=?").run(holder); },
    due(now: number): readonly WatchedSpot[] {
      const rows = db.prepare(`SELECT s.*,o.chat_id FROM spots s JOIN owners o ON s.owner=o.id
        WHERE o.chat_id IS NOT NULL AND s.next_check<=? ORDER BY s.next_check LIMIT 20`).all(now) as
        { owner: string; chat_id: number; config: string; qualified: number; notified_dates: string; confirmed_dates: string; notified_at: number | null }[];
      return rows.map((row) => ({ owner: row.owner, chatId: row.chat_id, spot: JSON.parse(row.config), config: row.config,
        qualified: !!row.qualified, notifiedDates: JSON.parse(row.notified_dates), confirmedDates: JSON.parse(row.confirmed_dates), notifiedAt: row.notified_at }));
    },
    checked(watch: WatchedSpot, summary: ForecastAlertSummary | null, now: number,
      notification?: Readonly<{ text: string; url: string; dates: readonly string[]; confirmation: boolean; confirmedDates: readonly string[] }>) {
      transaction(() => {
        if (ownerAt(watch.owner)?.chat_id !== watch.chatId) return;
        const row = db.prepare("SELECT config FROM spots WHERE owner=? AND id=?").get(watch.owner, watch.spot.id) as { config: string } | undefined;
        if (row?.config !== watch.config) return;
        const matching = summary !== null && summary.matchingDays >= watch.spot.alertMinDays;
        // Null = unavailable. It must not re-arm a previously qualifying alert.
        db.prepare(`UPDATE spots SET checked_at=?,next_check=?,error=?,summary=?,
          qualified=CASE WHEN ? THEN qualified ELSE 0 END WHERE owner=? AND id=?`).run(now,
          now + (summary ? 21_600_000 : 900_000), Number(!summary), summary ? JSON.stringify(summary) : null,
          Number(!summary || matching), watch.owner, watch.spot.id);
        if (notification && !db.prepare(`SELECT 1 FROM deliveries WHERE owner=? AND spot_id=? AND config=?
          AND state IN ('queued','retry','sending','uncertain')`).get(watch.owner, watch.spot.id, watch.config)) {
          const token = secret();
          db.prepare("INSERT INTO views VALUES (?,?,?,?)").run(digest(token), watch.owner, watch.spot.id, now + 7 * 86_400_000);
          const url = new URL(notification.url);
          url.hash = `forecast=${token}`;
          enqueue({ id: secret(), owner: watch.owner, chatId: watch.chatId, spotId: watch.spot.id, config: watch.config,
            ...notification, url: url.toString() }, now);
        }
      });
    },
    test(owner: string, now: number): boolean {
      const row = ownerAt(owner);
      if (!row?.chat_id) return false;
      const recent = db.prepare("SELECT 1 FROM deliveries WHERE owner=? AND spot_id IS NULL AND created_at>?").get(owner, now - 60_000);
      if (recent) return false;
      enqueue({ id: secret(), owner, chatId: row.chat_id, text: "Aer test notification. Your Telegram connection works; forecast checks continue with the app closed." }, now);
      return true;
    },
    pending(now: number): readonly Delivery[] {
      const rows = db.prepare("SELECT * FROM deliveries WHERE state IN ('queued','retry') AND next_try<=? ORDER BY next_try,created_at,rowid LIMIT 50").all(now) as Delivery[];
      const chats = new Set<number>();
      return rows.filter((row) => { if (chats.has(row.chat_id)) return false; chats.add(row.chat_id); return true; }).slice(0, 10);
    },
    beginDelivery(delivery: Delivery, now: number): boolean {
      return transaction(() => {
        const owner = delivery.owner ? ownerAt(delivery.owner) : null;
        const spot = delivery.spot_id && delivery.owner
          ? db.prepare("SELECT config FROM spots WHERE owner=? AND id=?").get(delivery.owner, delivery.spot_id) as { config: string } | undefined : null;
        if ((delivery.owner && owner?.chat_id !== delivery.chat_id) || (delivery.spot_id && spot?.config !== delivery.config)) {
          db.prepare("UPDATE deliveries SET state='cancelled' WHERE id=?").run(delivery.id); return false;
        }
        return db.prepare("UPDATE deliveries SET state='sending',attempts=attempts+1,next_try=? WHERE id=? AND state IN ('queued','retry')")
          .run(now, delivery.id).changes === 1;
      });
    },
    delivered(delivery: Delivery, result: TelegramSend, now: number) {
      transaction(() => {
        if (result.kind === "blocked") {
          const owners = db.prepare("SELECT id FROM owners WHERE chat_id=?").all(delivery.chat_id) as { id: string }[];
          owners.forEach((row) => disconnect(row.id, true));
        }
        const state = result.kind === "retry" && delivery.attempts >= 5 ? "failed" : result.kind;
        db.prepare("UPDATE deliveries SET state=?,next_try=?,sent_at=? WHERE id=?").run(state,
          result.kind === "retry" ? now + result.afterMs : now, result.kind === "sent" ? now : null, delivery.id);
        if (result.kind === "sent" && delivery.owner && delivery.spot_id && delivery.dates) {
          const dates = delivery.dates;
          db.prepare(`UPDATE spots SET notified_at=?,notified_dates=?,qualified=1,
            confirmed_dates=COALESCE(?,confirmed_dates)
            WHERE owner=? AND id=? AND config=?`).run(now, dates, delivery.confirmation_dates,
              delivery.owner, delivery.spot_id, delivery.config!);
        }
      });
    },
    prune(now: number) {
      db.prepare("DELETE FROM links WHERE expires_at<=?").run(now);
      db.prepare("DELETE FROM views WHERE expires_at<=?").run(now);
      db.prepare("DELETE FROM deliveries WHERE created_at<? AND state NOT IN ('queued','retry','sending','uncertain')").run(now - 30 * 86_400_000);
    },
  };
};
export type AlertStore = ReturnType<typeof openAlertStore>;

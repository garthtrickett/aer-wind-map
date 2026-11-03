import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { AccountUser } from "../../src/account-types.ts";
import type { SavedSpot } from "../../src/saved-spots.ts";

export const hashSecret = (text: string): string => createHash("sha256").update(text).digest("hex");
const secret = (): string => randomBytes(32).toString("base64url");
export const validSecret = (text: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(text);
export const normalizeEmail = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) ? email : null;
};
export const sessionLifetime = 30 * 86_400_000;
export const linkLifetime = 15 * 60_000;

export const openAccountStore = (path: string) => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS account_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL DEFAULT 0,
      telegram_owner TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS account_session_expiry ON account_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS account_login_links (
      token TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_spots (
      user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
      id TEXT NOT NULL, config TEXT NOT NULL, position INTEGER NOT NULL,
      PRIMARY KEY(user_id,id));
    CREATE TABLE IF NOT EXISTS account_imports (
      user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
      source TEXT NOT NULL, added INTEGER NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,source));
    CREATE TABLE IF NOT EXISTS account_rate_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const data = (userId: string) => {
    const user = db.prepare("SELECT revision FROM account_users WHERE id=?").get(userId) as { revision: number };
    return {
      revision: user.revision,
      spots: (db.prepare("SELECT config FROM account_spots WHERE user_id=? ORDER BY position").all(userId) as { config: string }[])
        .map((row) => JSON.parse(row.config) as SavedSpot),
      importedSources: (db.prepare("SELECT source FROM account_imports WHERE user_id=?").all(userId) as { source: string }[]).map((row) => row.source),
    };
  };
  const write = (userId: string, spots: readonly SavedSpot[]) => {
    db.prepare("DELETE FROM account_spots WHERE user_id=?").run(userId);
    const insert = db.prepare("INSERT INTO account_spots VALUES (?,?,?,?)");
    spots.forEach((spot, index) => insert.run(userId, spot.id, JSON.stringify(spot), index));
    db.prepare("UPDATE account_users SET revision=revision+1 WHERE id=?").run(userId);
  };
  const setTelegramOwner = (userId: string, owner: string) => {
    const other = db.prepare("SELECT id FROM account_users WHERE telegram_owner=?").get(owner) as { id: string } | undefined;
    if (other && other.id !== userId) return false;
    db.prepare("UPDATE account_users SET telegram_owner=? WHERE id=?").run(owner, userId);
    return true;
  };
  return {
    close: () => db.close(), data, setTelegramOwner,
    telegramOwner: (userId: string): string | null =>
      (db.prepare("SELECT telegram_owner FROM account_users WHERE id=?").get(userId) as { telegram_owner: string | null }).telegram_owner,
    session(token: string | null, now: number): AccountUser | null {
      if (!token || !validSecret(token)) return null;
      const row = db.prepare(`SELECT u.id,u.email FROM account_sessions s JOIN account_users u ON u.id=s.user_id
        WHERE s.token=? AND s.expires_at>?`).get(hashSecret(token), now) as AccountUser | undefined;
      return row ?? null;
    },
    issueLink(email: string, now: number): string {
      db.prepare("DELETE FROM account_login_links WHERE expires_at<=?").run(now);
      const token = secret();
      db.prepare("INSERT INTO account_login_links VALUES (?,?,?)").run(hashSecret(token), email, now + linkLifetime);
      return token;
    },
    previewLink(token: string, now: number): string | null {
      if (!validSecret(token)) return null;
      return (db.prepare("SELECT email FROM account_login_links WHERE token=? AND expires_at>?")
        .get(hashSecret(token), now) as { email: string } | undefined)?.email ?? null;
    },
    revokeLink(token: string) { db.prepare("DELETE FROM account_login_links WHERE token=?").run(hashSecret(token)); },
    consumeLink(token: string, now: number, legacyOwner: string | null): { token: string; user: AccountUser } | null {
      if (!validSecret(token)) return null;
      return transaction(() => {
        const row = db.prepare("SELECT email FROM account_login_links WHERE token=? AND expires_at>?")
          .get(hashSecret(token), now) as { email: string } | undefined;
        if (!row) return null;
        db.prepare("DELETE FROM account_login_links WHERE email=?").run(row.email);
        db.prepare("INSERT OR IGNORE INTO account_users(id,email,created_at) VALUES (?,?,?)").run(randomUUID(), row.email, now);
        const user = db.prepare("SELECT id,email FROM account_users WHERE email=?").get(row.email) as AccountUser;
        if (legacyOwner && !this.telegramOwner(user.id)) setTelegramOwner(user.id, legacyOwner);
        db.prepare("DELETE FROM account_sessions WHERE expires_at<=?").run(now);
        const session = secret();
        db.prepare("INSERT INTO account_sessions VALUES (?,?,?)").run(hashSecret(session), user.id, now + sessionLifetime);
        return { token: session, user };
      });
    },
    logout(token: string | null) { if (token) db.prepare("DELETE FROM account_sessions WHERE token=?").run(hashSecret(token)); },
    replace(userId: string, spots: readonly SavedSpot[], revision: number): boolean {
      return transaction(() => {
        if (data(userId).revision !== revision) return false;
        write(userId, spots); return true;
      });
    },
    importBrowser(userId: string, source: string, spots: readonly SavedSpot[], now: number): { added: number; alreadyImported: boolean } {
      return transaction(() => {
        const prior = db.prepare("SELECT added FROM account_imports WHERE user_id=? AND source=?").get(userId, source) as { added: number } | undefined;
        if (prior) return { added: prior.added, alreadyImported: true };
        const existing = data(userId).spots;
        const byId = new Map(existing.map((spot) => [spot.id, spot]));
        // Reserve every incoming ID before generating replacements. Rewrite the
        // whole imported graph together, so shared swell links survive collisions.
        const reserved = new Set([...byId.keys(), ...spots.map((spot) => spot.id)]);
        const ids = new Map<string, string>();
        for (const spot of spots) {
          if (!byId.has(spot.id)) { ids.set(spot.id, spot.id); continue; }
          let id: string; do { id = randomUUID(); } while (reserved.has(id));
          reserved.add(id); ids.set(spot.id, id);
        }
        const incoming = spots.map((spot) => ({ ...spot, id: ids.get(spot.id)!,
          ...(spot.linkedSpotIds ? { linkedSpotIds: spot.linkedSpotIds.map((id) => ids.get(id) ?? id) } : {}) }));
        if (existing.length + incoming.length > 2000) throw new Error("spot_limit");
        if (incoming.length) write(userId, [...existing, ...incoming]);
        db.prepare("INSERT INTO account_imports VALUES (?,?,?,?)").run(userId, source, incoming.length, now);
        return { added: incoming.length, alreadyImported: false };
      });
    },
    allow(key: string, maximum: number, windowMs: number, now: number): boolean {
      return transaction(() => {
        db.prepare("DELETE FROM account_rate_limits WHERE expires_at<=?").run(now);
        const id = hashSecret(key);
        const count = (db.prepare("SELECT count FROM account_rate_limits WHERE key=?").get(id) as { count: number } | undefined)?.count ?? 0;
        if (count >= maximum || (db.prepare("SELECT COUNT(*) AS n FROM account_rate_limits").get() as { n: number }).n > 10_000) return false;
        db.prepare(`INSERT INTO account_rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1`)
          .run(id, now + windowMs);
        return true;
      });
    },
  };
};
export type AccountStore = ReturnType<typeof openAccountStore>;

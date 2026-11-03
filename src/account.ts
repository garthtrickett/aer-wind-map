import { initialAccount, validAccountSpots, type AccountAction, type AccountPanel, type AccountSnapshot } from "./account-types.ts";
import { browserImportSource, mergeAccountSpots, readPendingAccountSpots, writePendingAccountSpots } from "./account-sync.ts";
import { readSavedSpots, writeSavedSpots, type SavedSpot, type SaveResult } from "./saved-spots.ts";

type Reply = AccountSnapshot & { error?: string; message?: string; email?: string; added?: number; alreadyImported?: boolean };
class AccountError extends Error {
  readonly status: number;
  readonly reply: Reply;
  constructor(message: string, status: number, reply: Reply) { super(message); this.status = status; this.reply = reply; }
}
export const createAccountClient = ({ storage, changed, fetcher = fetch }: {
  storage: () => Storage;
  changed: (panel: AccountPanel, spots?: readonly SavedSpot[], resetSession?: boolean) => void;
  fetcher?: typeof fetch;
}) => {
  let panel = initialAccount;
  let snapshot: AccountSnapshot | null = null;
  let desired: readonly SavedSpot[] | null = null;
  let syncing = false;
  let epoch = 0;
  let loginToken: string | null = null;
  let loginSequence = 0;
  let conflict: AccountSnapshot | null = null;
  let recoveryBlocked = false;
  const emit = (patch: Partial<AccountPanel>, spots?: readonly SavedSpot[], resetSession = false) => {
    panel = { ...panel, ...patch }; changed(panel, spots, resetSession);
  };
  const browserInfo = () => {
    const local = readSavedSpots(storage);
    return { browserCount: local.ok ? local.value.length : 0, browserInvalid: !local.ok };
  };
  const request = async (path: string, method = "GET", body?: object): Promise<Reply> => {
    const response = await fetcher(`/api/account/${path}`, { method, credentials: "same-origin", signal: AbortSignal.timeout(20_000),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    let reply: Reply;
    try { reply = await response.json(); }
    catch { throw new AccountError("Account service is unavailable. Your browser spots are safe.", response.status, {} as Reply); }
    if (!response.ok) throw new AccountError(reply.error ?? "Your account could not be updated. Please try again.", response.status, reply);
    return reply;
  };
  const validSnapshot = (value: Reply): boolean => typeof value.available === "boolean" && typeof value.emailEnabled === "boolean" &&
    (value.user === null || !!value.user && typeof value.user.id === "string" && typeof value.user.email === "string") &&
    validAccountSpots(value.spots) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    Array.isArray(value.importedSources) && value.importedSources.every((source) => typeof source === "string");
  const cache = () => {
    if (snapshot?.user) writePendingAccountSpots(storage(), snapshot.user.id, desired
      ? { revision: snapshot.revision, base: snapshot.spots, spots: desired } : null);
  };
  const imported = (next: AccountSnapshot): boolean => {
    try { return next.importedSources.includes(browserImportSource(storage())); }
    catch { return false; }
  };
  const accept = (next: Reply) => {
    if (!validSnapshot(next)) throw new Error("The account service returned invalid saved data. Nothing was imported.");
    const reset = panel.user?.id !== next.user?.id;
    snapshot = next; desired = null; conflict = null;
    recoveryBlocked = false;
    let recoveryError: string | null = null;
    let spots: readonly SavedSpot[];
    if (next.user) {
      spots = next.spots;
      try {
        const pending = readPendingAccountSpots(storage(), next.user.id);
        if (pending && JSON.stringify(pending.spots) !== JSON.stringify(next.spots)) {
          desired = mergeAccountSpots(pending.base, pending.spots, next.spots);
          if (!desired) { desired = pending.spots; conflict = next; }
          spots = desired;
        } else writePendingAccountSpots(storage(), next.user.id, null);
      } catch {
        recoveryBlocked = true;
        recoveryError = "Device recovery storage could not be read. Your server spots are shown; the recovery copy has been kept.";
      }
    } else {
      const local = readSavedSpots(storage); spots = local.ok ? local.value : [];
    }
    emit({ phase: next.user ? "signedIn" : next.available ? "guest" : "unavailable", emailEnabled: next.emailEnabled,
      user: next.user, ...browserInfo(), imported: imported(next), sync: conflict ? "conflict" : desired ? "saving" : next.user ? "saved" : "idle",
      confirmEmail: null, error: conflict ? "This spot was also changed on another device. Choose which version to keep." : recoveryError }, spots, reset);
    if (desired && !conflict) queueMicrotask(() => { void flush(); });
  };
  const failure = (cause: unknown) => emit({ busy: false, error: cause instanceof Error ? cause.message : "Please check your connection and try again." });
  const flush = async (): Promise<void> => {
    if (syncing || !desired || !snapshot?.user || conflict || panel.busy) return;
    syncing = true;
    const run = epoch;
    emit({ sync: "saving", error: null });
    try {
      let attempts = 0;
      while (desired && run === epoch && attempts++ < 4) {
        const sending: readonly SavedSpot[] = desired;
        try {
          const next = await request("spots", "PUT", { userId: snapshot!.user!.id, spots: sending, revision: snapshot!.revision });
          if (run !== epoch) return;
          if (!validSnapshot(next) || next.user?.id !== snapshot!.user!.id) throw new Error("Account session changed. Reload your account before saving.");
          snapshot = next;
          if (desired === sending) desired = null;
          try { cache(); }
          catch (cause) {
            if (desired) throw cause;
            emit({ message: "Saved to your account. This device’s recovery cache could not be cleared." });
          }
        } catch (cause) {
          if (run !== epoch) return;
          if (!(cause instanceof AccountError) || cause.status !== 409 || !validSnapshot(cause.reply) || cause.reply.user?.id !== snapshot!.user!.id) throw cause;
          const merged = mergeAccountSpots(snapshot!.spots, desired!, cause.reply.spots);
          if (!merged) {
            conflict = cause.reply;
            emit({ sync: "conflict", error: "A spot was changed on another device. Your changes are kept here; choose which version to use." });
            return;
          }
          snapshot = cause.reply; desired = merged; cache();
          emit({}, desired);
        }
      }
      if (run === epoch) emit({ sync: desired ? "error" : "saved", error: desired ? "Spots are changing on another device. Retry saving shortly." : null });
    } catch (cause) {
      if (run === epoch) emit({ sync: "error", error: cause instanceof Error ? cause.message : "Could not sync. Your changes are kept on this device." });
    } finally { syncing = false; }
  };
  const load = async (): Promise<void> => {
    if (syncing || desired) { emit({ error: "Save or resolve your pending changes before refreshing your account." }); return; }
    const run = ++epoch;
    emit({ busy: true, error: null });
    try { const next = await request("session"); if (run === epoch) accept(next); }
    catch (cause) { if (run === epoch) { emit({ phase: snapshot?.user ? "signedIn" : "unavailable", ...browserInfo() }); failure(cause); } }
    finally { if (run === epoch) { emit({ busy: false }); if (desired && !conflict) void flush(); } }
  };
  const action = async (action: AccountAction): Promise<void> => {
    if (action.kind === "retrySync") { if (!conflict) void flush(); return; }
    if (action.kind === "refresh") { await load(); return; }
    if (panel.busy || syncing) return;
    if (action.kind === "useServer" || action.kind === "keepLocal") {
      if (!conflict || !snapshot?.user) return;
      snapshot = conflict; conflict = null;
      if (action.kind === "useServer") desired = null;
      cache();
      emit({ sync: desired ? "saving" : "saved", error: null }, desired ?? snapshot.spots);
      void flush(); return;
    }
    if (action.kind === "logout" && desired) { emit({ error: "Save or resolve your unsynced changes before signing out." }); return; }
    const run = epoch;
    emit({ busy: true, error: null, message: null });
    try {
      if (action.kind === "requestLink") {
        const reply = await request("request-link", "POST", { email: action.email });
        if (run === epoch) emit({ message: reply.message ?? "Check your inbox for your sign-in link." });
      } else if (action.kind === "confirmLink") {
        if (!loginToken) throw new Error("Request a new sign-in link.");
        if (desired && panel.confirmEmail !== snapshot?.user?.email) throw new Error("Save your current changes before switching accounts.");
        const next = await request("confirm-link", "POST", { token: loginToken });
        if (run !== epoch) return;
        loginToken = null; accept(next);
        emit({ message: "Signed in. Your saved spots are available on your other devices." });
      } else if (action.kind === "logout") {
        const next = await request("logout", "POST", { userId: snapshot?.user?.id });
        if (run === epoch) accept(next);
      } else if (action.kind === "importBrowser") {
        if (!snapshot?.user || desired) throw new Error("Save or resolve your account changes before importing.");
        const local = readSavedSpots(storage);
        if (!local.ok) throw new Error("Browser spots could not be read. Nothing was imported or removed.");
        if (!local.value.length) throw new Error("There are no browser spots to import here.");
        const next = await request("import", "POST", { userId: snapshot.user.id, source: browserImportSource(storage()), spots: local.value });
        if (run !== epoch) return;
        accept(next);
        emit({ message: next.alreadyImported ? "This browser’s spots have already been imported."
          : `Imported ${next.added} spots to your account. The original browser copy is still here.` });
      }
    } catch (cause) { if (run === epoch) failure(cause); }
    finally { if (run === epoch) { emit({ busy: false }); if (desired && !conflict) void flush(); } }
  };
  return {
    action, load,
    persist(spots: readonly SavedSpot[]): SaveResult {
      if (!snapshot?.user) {
        const result = writeSavedSpots(storage, spots);
        if (result.ok) queueMicrotask(() => emit(browserInfo()));
        return result;
      }
      if (recoveryBlocked) return { ok: false, error: { kind: "unavailable" } };
      const previous = desired;
      desired = spots;
      try { cache(); }
      catch { desired = previous; return { ok: false, error: { kind: "unavailable" } }; }
      queueMicrotask(() => { void flush(); });
      return { ok: true };
    },
    async start(token: string | null) {
      const sequence = ++loginSequence;
      await load();
      if (!token || sequence !== loginSequence) return;
      loginToken = token;
      emit({ busy: true });
      try {
        const reply = await request("preview-link", "POST", { token });
        if (sequence !== loginSequence) return;
        if (typeof reply.email !== "string") throw new Error("This sign-in link is invalid.");
        emit({ confirmEmail: reply.email });
      } catch (cause) { if (sequence === loginSequence) failure(cause); }
      finally { if (sequence === loginSequence) emit({ busy: false }); }
    },
  };
};

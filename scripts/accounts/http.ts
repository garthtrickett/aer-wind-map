import type { IncomingMessage, ServerResponse } from "node:http";
import { validAccountSpots } from "../../src/account-types.ts";
import { hashSecret, normalizeEmail, sessionLifetime, validSecret, type AccountStore } from "./store.ts";
import type { LoginMailer } from "./email.ts";

export const cookieValue = (request: IncomingMessage, name: string): string | null =>
  request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

export const createAccountHttp = ({ store, publicUrl, mailer, clock = Date.now }: {
  store: AccountStore | null; publicUrl: string; mailer: LoginMailer | null; clock?: () => number;
}) => {
  const cookie = (name: string, token: string, age: number) =>
    `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${publicUrl.startsWith("https:") ? "; Secure" : ""}`;
  const json = (response: ServerResponse, code: number, body: object) => {
    response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    response.end(JSON.stringify(body));
  };
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const route = new URL(request.url ?? "/", "http://localhost").pathname;
    const now = clock();
    const token = cookieValue(request, "aer_session");
    const user = store?.session(token, now) ?? null;
    const snapshot = () => ({ available: !!store, emailEnabled: !!store && !!mailer, user,
      ...(user ? store!.data(user.id) : { spots: [], revision: 0, importedSources: [] }) });
    if (route === "/api/account/session" && request.method === "GET") { json(response, 200, snapshot()); return; }
    if (!store) { json(response, 503, { error: "Account storage is not configured yet. Your browser spots are still available." }); return; }
    if (!["POST", "PUT"].includes(request.method ?? "")) { json(response, 405, { error: "Method not allowed" }); return; }
    if (request.headers.origin !== new URL(publicUrl).origin || request.headers["sec-fetch-site"] === "cross-site") {
      json(response, 403, { error: "Open Aer directly to manage your account." }); return;
    }
    if (!request.headers["content-type"]?.startsWith("application/json")) { json(response, 415, { error: "JSON required" }); return; }
    const ip = request.socket.remoteAddress ?? "unknown";
    if (!store.allow(`requests:${ip}`, 300, 60_000, now)) { json(response, 429, { error: "Too many requests. Please wait a minute." }); return; }
    let raw: Record<string, unknown>;
    try {
      let size = 0; const parts: Buffer[] = [];
      request.setTimeout(10_000, () => request.destroy());
      for await (const part of request) {
        const buffer = Buffer.from(part); size += buffer.length;
        if (size > 2_097_152) { json(response, 413, { error: "The maximum import size is 2 MiB." }); request.resume(); return; }
        parts.push(buffer);
      }
      raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid");
    } catch { json(response, 400, { error: "Invalid JSON request." }); return; }
    try {
      if (route === "/api/account/request-link" && request.method === "POST") {
        if (!mailer) { json(response, 503, { error: "Login emails are not configured yet. Your browser spots are safe." }); return; }
        const email = normalizeEmail(raw.email);
        if (!email) { json(response, 400, { error: "Enter a valid email address." }); return; }
        if (!store.allow(`email:${email}`, 3, 900_000, now) || !store.allow(`email-ip:${ip}`, 20, 900_000, now) ||
          !store.allow("email-global", 100, 3_600_000, now)) {
          json(response, 429, { error: "Too many sign-in emails. Please wait before requesting another." }); return;
        }
        const link = store.issueLink(email, now);
        try { await mailer(email, `${publicUrl.replace(/\/$/, "")}/#login=${link}`); }
        catch { store.revokeLink(link); json(response, 503, { error: "The sign-in email could not be sent. Please try again later." }); return; }
        json(response, 202, { message: "Check your inbox for your Aer sign-in link. It expires in 15 minutes." }); return;
      }
      if (["/api/account/preview-link", "/api/account/confirm-link"].includes(route) && request.method === "POST") {
        if (typeof raw.token !== "string" || !validSecret(raw.token) || !store.allow(`verify:${ip}`, 60, 900_000, now)) {
          json(response, 400, { error: "This sign-in link is invalid or expired. Request a new one." }); return;
        }
        if (route.endsWith("preview-link")) {
          const email = store.previewLink(raw.token, now);
          json(response, email ? 200 : 400, email ? { email } : { error: "This sign-in link is invalid or expired. Request a new one." }); return;
        }
        const legacyCookie = cookieValue(request, "aer_alerts");
        const login = store.consumeLink(raw.token, now, legacyCookie && validSecret(legacyCookie) ? hashSecret(legacyCookie) : null);
        if (!login) { json(response, 400, { error: "This sign-in link is invalid or expired. Request a new one." }); return; }
        // Rotate any current session. A link cannot fixate a previously issued session.
        store.logout(token);
        response.setHeader("Set-Cookie", cookie("aer_session", login.token, sessionLifetime / 1000));
        json(response, 200, { available: true, emailEnabled: !!mailer, user: login.user, ...store.data(login.user.id) }); return;
      }
      if (route === "/api/account/logout" && request.method === "POST") {
        if (raw.userId && raw.userId !== user?.id) { json(response, 401, { error: "Your account session changed. Refresh before signing out." }); return; }
        store.logout(token);
        response.setHeader("Set-Cookie", [cookie("aer_session", "", 0), cookie("aer_alerts", "", 0)]);
        json(response, 200, { available: true, emailEnabled: !!mailer, user: null, spots: [], revision: 0, importedSources: [] }); return;
      }
      if (!user) { json(response, 401, { error: "Sign in to save spots to your account. Your changes remain on this device." }); return; }
      if (raw.userId !== user.id) { json(response, 401, { error: "Your account session changed. Reload Aer before saving. Your changes are kept on this device." }); return; }
      if (route === "/api/account/spots" && request.method === "PUT") {
        if (!validAccountSpots(raw.spots) || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0) {
          json(response, 400, { error: "Send a valid saved-spot collection (maximum 2,000 spots)." }); return;
        }
        if (!store.replace(user.id, raw.spots, raw.revision as number)) {
          json(response, 409, { error: "Saved spots changed on another device.", ...snapshot() }); return;
        }
        json(response, 200, snapshot()); return;
      }
      if (route === "/api/account/import" && request.method === "POST") {
        if (!validAccountSpots(raw.spots) || typeof raw.source !== "string" || !/^[a-f0-9-]{36}$/.test(raw.source)) {
          json(response, 400, { error: "The browser import is invalid. Nothing was imported." }); return;
        }
        const result = store.importBrowser(user.id, raw.source, raw.spots, now);
        json(response, 200, { ...snapshot(), ...result }); return;
      }
      json(response, 404, { error: "Not found" });
    } catch {
      json(response, 503, { error: "Account storage is temporarily unavailable. Your browser data has not been removed." });
    }
  };
};

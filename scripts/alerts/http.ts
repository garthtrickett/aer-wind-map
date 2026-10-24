import type { IncomingMessage, ServerResponse } from "node:http";
import { isSavedSpot } from "../../src/saved-spots.ts";
import { disconnectedTelegram } from "../../src/telegram-types.ts";
import { digest, type AlertStore } from "./store.ts";

export const createAlertHttp = ({ store, username, publicUrl, clock = Date.now }: Readonly<{
  store: AlertStore | null; username: string; publicUrl: string; clock?: () => number;
}>) => {
  const limits = new Map<string, { count: number; until: number }>();
  const limit = (key: string, maximum: number): boolean => {
    const now = clock();
    if (limits.size > 2000) for (const [id, entry] of limits) if (entry.until <= now) limits.delete(id);
    let entry = limits.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + 900_000 }; limits.set(key, entry); }
    return ++entry.count <= maximum && limits.size <= 4000;
  };
  const json = (response: ServerResponse, code: number, body: object) => {
    response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(JSON.stringify(body));
  };
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url || "/", "http://localhost");
    const route = url.pathname;
    if (!store) { json(response, 200, { status: disconnectedTelegram }); return; }
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("aer_alerts="))?.slice(11);
    const owner = cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie) ? digest(cookie) : null;
    const now = clock();
    const current = () => store.status(owner, now);
    if (request.method === "GET") {
      if (route === "/api/telegram/status") { json(response, 200, { status: current() }); return; }
      if (route === "/api/telegram/spot" && owner) {
        const spot = store.spot(owner, url.searchParams.get("id") ?? "");
        json(response, spot ? 200 : 404, spot ? { status: current(), spot, linkedSpots: store.linkedSpots(owner, spot.id) } : { error: "Spot unavailable in this browser. Open the original browser used to connect Telegram." }); return;
      }
      json(response, 404, { error: "Not found" }); return;
    }
    if (!["POST", "PUT"].includes(request.method ?? "")) { json(response, 405, { error: "Method not allowed" }); return; }
    const origin = new URL(publicUrl).origin;
    if (request.headers.origin !== origin || request.headers["sec-fetch-site"] === "cross-site") {
      json(response, 403, { error: "Open Aer directly to change Telegram alerts." }); return;
    }
    if (!request.headers["content-type"]?.startsWith("application/json")) { json(response, 415, { error: "JSON required" }); return; }
    if (!limit(`owner:${owner ?? request.socket.remoteAddress ?? "unknown"}`, 100)) { json(response, 429, { error: "Too many requests. Try again later." }); return; }
    let raw: unknown;
    try {
      let size = 0; const parts: Buffer[] = [];
      // Prevent a client keeping the request open indefinitely.
      request.setTimeout(10_000, () => request.destroy());
      for await (const part of request) { const buffer = Buffer.from(part); size += buffer.length; if (size > 65_536) throw new Error("size"); parts.push(buffer); }
      raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch { json(response, 400, { error: "Invalid request (maximum 64 KiB)." }); return; }
    try {
      if (route === "/api/telegram/view" && request.method === "POST") {
        const token = (raw as { token?: unknown } | null)?.token;
        const spot = typeof token === "string" ? store.view(token, now) : null;
        json(response, spot ? 200 : 404, spot ? { status: current(), spot, linkedSpots: store.viewLinked(token as string, now) }
          : { error: "This forecast link expired or its alert was removed. Ask for a new alert link." }); return;
      }
      if (route === "/api/telegram/connect" && request.method === "POST") {
        if (!limit(`link:${request.socket.remoteAddress ?? "unknown"}`, 10)) { json(response, 429, { error: "Too many connection links. Try again in 15 minutes." }); return; }
        const result = store.beginLink(owner, now);
        if (result.cookie) response.setHeader("Set-Cookie", `aer_alerts=${result.cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${publicUrl.startsWith("https:") ? "; Secure" : ""}`);
        json(response, 200, { status: store.status(result.cookie ? digest(result.cookie) : owner, now),
          connectUrl: `https://t.me/${username}?start=${result.token}`, expiresAt: now + 600_000 }); return;
      }
      if (!owner || !store.hasOwner(owner)) { json(response, 401, { error: "Connect Telegram from this browser first." }); return; }
      if (route === "/api/telegram/spots" && request.method === "PUT") {
        const body = raw as { spots?: unknown; revision?: unknown } | null;
        if (!body || !Array.isArray(body.spots) || body.spots.length > 50 || !body.spots.every((spot) => isSavedSpot(spot)) ||
          new Set(body.spots.map((spot) => spot.id)).size !== body.spots.length || !Number.isSafeInteger(body.revision)) {
          json(response, 400, { error: "Send at most 50 valid saved spots, including linked conditions." }); return;
        }
        if (!store.sync(owner, body.spots, body.revision as number)) { json(response, 409, { error: "Connection or settings changed. Refresh the connection status and sync again." }); return; }
        json(response, 200, { status: current() }); return;
      }
      if (route === "/api/telegram/disconnect" && request.method === "POST") {
        store.disconnect(owner); json(response, 200, { status: current() }); return;
      }
      if (route === "/api/telegram/test" && request.method === "POST") {
        if (!store.test(owner, now)) { json(response, 429, { error: "Connect Telegram first, then allow a minute between test messages." }); return; }
        json(response, 202, { status: current() }); return;
      }
      json(response, 404, { error: "Not found" });
    } catch { json(response, 503, { error: "Telegram settings are temporarily unavailable. Try again." }); }
  };
};

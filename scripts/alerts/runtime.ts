import { isAbsolute } from "node:path";
import { createAlertHttp } from "./http.ts";
import { createMonitor } from "./monitor.ts";
import { openAlertStore } from "./store.ts";
import { createTelegram } from "./telegram.ts";

export const createAlertRuntime = (env: NodeJS.ProcessEnv = process.env) => {
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  const username = (env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
  const publicUrl = env.PUBLIC_APP_URL ?? "";
  const database = env.AER_ALERT_DB ?? "";
  if (!token || !username || !publicUrl || !database) {
    return { handle: createAlertHttp({ store: null, username: "", publicUrl: "" }), stop: async () => {} };
  }
  const url = new URL(publicUrl);
  if ((!isAbsolute(database)) || !/^[A-Za-z0-9_]{5,32}$/.test(username) ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Aer Telegram requires an absolute durable database path, valid bot username and HTTPS app origin");
  const store = openAlertStore(database);
  const telegram = createTelegram({ token });
  const monitor = createMonitor({ store, telegram, publicUrl });
  const controller = new AbortController();
  let ready = false;
  const handle = createAlertHttp({ store, username, publicUrl });
  const unavailable = createAlertHttp({ store: null, username: "", publicUrl: "" });
  const task = (async () => {
    while (!controller.signal.aborted && !ready) {
      try {
        const actual = await telegram.identity(controller.signal);
        if (actual.toLowerCase() !== username.toLowerCase()) throw new Error("Bot username mismatch");
        ready = true;
      } catch {
        if (controller.signal.aborted) break;
        process.stderr.write("Aer Telegram: verify the bot credentials; retrying in one minute\n");
        try { await import("node:timers/promises").then(({ setTimeout }) => setTimeout(60_000, undefined, { signal: controller.signal })); }
        catch { break; }
      }
    }
    if (ready) await monitor.run(controller.signal);
  })();
  return {
    handle: ((request, response) => (ready ? handle : unavailable)(request, response)) as typeof handle,
    async stop() { controller.abort(); await task; store.close(); },
  };
};

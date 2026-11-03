import { isAbsolute } from "node:path";
import type { IncomingMessage } from "node:http";
import { createAccountHttp, cookieValue } from "./http.ts";
import { createResendMailer } from "./email.ts";
import { hashSecret, openAccountStore, validSecret } from "./store.ts";

export const createAccountRuntime = (env: NodeJS.ProcessEnv = process.env) => {
  const path = env.AER_ACCOUNT_DB ?? (env.RAILWAY_VOLUME_MOUNT_PATH ? `${env.RAILWAY_VOLUME_MOUNT_PATH}/aer-accounts.sqlite` : "");
  const publicUrl = env.PUBLIC_APP_URL ?? "";
  const key = env.RESEND_API_KEY ?? "";
  const from = env.AER_EMAIL_FROM ?? "";
  if (path) {
    const url = new URL(publicUrl);
    if (!isAbsolute(path) || url.origin !== publicUrl.replace(/\/$/, "") ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))))
      throw new Error("Aer accounts require an absolute durable database path and an HTTPS PUBLIC_APP_URL origin");
  }
  const store = path ? openAccountStore(path) : null;
  const userFor = (request: IncomingMessage) => store?.session(cookieValue(request, "aer_session"), Date.now()) ?? null;
  return {
    handle: createAccountHttp({ store, publicUrl, mailer: key && from ? createResendMailer(key, from) : null }),
    accountFor: (request: IncomingMessage): string | null => userFor(request)?.id ?? (cookieValue(request, "aer_session") ? "expired-session" : null),
    ownerFor(request: IncomingMessage): string | null {
      const user = userFor(request);
      if (user) return store!.telegramOwner(user.id);
      // An expired account cookie must never fall back to another account's
      // legacy Telegram capability. Guest-only browsers retain their old flow.
      if (cookieValue(request, "aer_session")) return null;
      const legacy = cookieValue(request, "aer_alerts");
      return legacy && validSecret(legacy) ? hashSecret(legacy) : null;
    },
    rememberOwner(request: IncomingMessage, owner: string) {
      const user = userFor(request);
      if (user && !store!.setTelegramOwner(user.id, owner)) throw new Error("Telegram connection belongs to another account");
    },
    stop() { store?.close(); },
  };
};

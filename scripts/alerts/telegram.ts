// This is the only module that knows the bot token or Telegram's wire format.
export type TelegramUpdate = Readonly<{
  update_id: number;
  message?: Readonly<{
    message_id: number;
    text?: string;
    chat: Readonly<{ id: number; type: string }>;
    from?: Readonly<{ id: number; is_bot?: boolean }>;
  }>;
}>;
export type TelegramSend =
  | Readonly<{ kind: "sent"; messageId: number }>
  | Readonly<{ kind: "blocked" }>
  | Readonly<{ kind: "retry"; afterMs: number }>
  | Readonly<{ kind: "uncertain" }>
  | Readonly<{ kind: "failed" }>;

export const createTelegram = ({ token, fetcher = fetch }: Readonly<{ token: string; fetcher?: typeof fetch }>) => {
  const call = (method: string, body: object, signal: AbortSignal) => fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  return {
    async identity(signal: AbortSignal): Promise<string> {
      const response = await call("getMe", {}, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      const raw = await response.json();
      if (!response.ok || raw.ok !== true || raw.result?.is_bot !== true || typeof raw.result.username !== "string")
        throw new Error("Telegram identity unavailable");
      return raw.result.username;
    },
    async updates(offset: number, signal: AbortSignal): Promise<readonly TelegramUpdate[]> {
      const response = await call("getUpdates", { offset, timeout: 25, limit: 100, allowed_updates: ["message"] },
        AbortSignal.any([signal, AbortSignal.timeout(35_000)]));
      const raw = await response.json();
      if (!response.ok || raw.ok !== true || !Array.isArray(raw.result)) throw new Error("Telegram polling unavailable");
      return raw.result.filter((item: TelegramUpdate) => Number.isSafeInteger(item.update_id));
    },
    async send(chatId: number, text: string, url?: string): Promise<TelegramSend> {
      try {
        const response = await call("sendMessage", { chat_id: chatId, text,
          link_preview_options: { is_disabled: true },
          ...(url ? { reply_markup: { inline_keyboard: [[{ text: "Open saved spot", url }]] } } : {}),
        }, AbortSignal.timeout(15_000));
        // A received, explicit rejection can safely be retried. A missing or
        // malformed acceptance cannot: Telegram offers no idempotency key.
        const raw = await response.json();
        if (raw.ok === true && Number.isSafeInteger(raw.result?.message_id)) return { kind: "sent", messageId: raw.result.message_id };
        if (raw.ok !== false) return { kind: "uncertain" };
        if (raw.error_code === 403) return { kind: "blocked" };
        if (raw.error_code === 429 || raw.error_code >= 500) return { kind: "retry",
          afterMs: Math.min(86_400_000, Math.max(60_000, Number(raw.parameters?.retry_after || 300) * 1000)) };
        return { kind: "failed" };
      } catch { return { kind: "uncertain" }; }
    },
  };
};
export type Telegram = ReturnType<typeof createTelegram>;

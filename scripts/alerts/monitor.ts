import { alertRulesFor } from "../../src/alert-rules.ts";
import { evaluateForecastRules, loadForecastAlerts, type ForecastAlertCheck, type ForecastAlertSummary } from "../../src/forecast-alerts.ts";
import type { SavedSpot } from "../../src/saved-spots.ts";
import { secret, type AlertStore, type WatchedSpot } from "./store.ts";
import type { Telegram } from "./telegram.ts";

type ForecastLoader = (spots: readonly SavedSpot[], now: Date) => Promise<readonly ForecastAlertCheck[]>;

const dateText = (time: number, timezone: string): string => new Intl.DateTimeFormat("en-GB", {
  timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(time * 1000));
const clockText = (time: number, timezone: string): string => new Intl.DateTimeFormat("en-GB", {
  timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(time * 1000));

export const notificationFor = (watch: WatchedSpot, summary: ForecastAlertSummary, now: number, publicUrl: string) => {
  const evaluation = evaluateForecastRules(summary, alertRulesFor(watch.spot));
  if (!evaluation.matched || !evaluation.windows.length) return null;
  if (watch.notifiedAt !== null && now - watch.notifiedAt < 21_600_000) return null;
  const dates = evaluation.windows.map((window) => window.day);
  const newDates = dates.some((date) => !watch.notifiedDates.includes(date));
  const near = evaluation.windows.filter((window) => window.start * 1000 <= now + 72 * 3_600_000).map((window) => window.day);
  const confirmation = watch.qualified && !newDates && near.some((day) => !watch.confirmedDates.includes(day));
  if (watch.qualified && !newDates && !confirmation) return null;
  const spot = watch.spot;
  const title = confirmation ? "Closer-range forecast confirmation" : near.length ? "Forecast matches" : "Early forecast heads-up";
  const text = [
    `${spot.name} — ${title}`,
    "Alert when any rule matches:",
    ...evaluation.rules.map((rule) => `${rule.met ? "Met" : "Not met"}: ${rule.matchingDays} of the next ${rule.withinDays} days match; need ${rule.minDays}.`),
    `At least ${summary.requiredHours} consecutive hourly samples, between 06:00 and 18:00.`,
    ...evaluation.windows.map((window) => `${dateText(window.start, summary.timezone)}–${clockText(window.end, summary.timezone)}`),
    `Local time: ${summary.timezone}.`,
    `Swell ${spot.criteria.minSwellHeight}–${spot.criteria.maxSwellHeight} m; period ${spot.criteria.minSwellPeriod}–${spot.criteria.maxSwellPeriod ?? "unlimited"} s.`,
    `Swell from ${spot.criteria.swellFromStart}° → ${spot.criteria.swellFromEnd}° clockwise.`,
    `Wind ≤${spot.criteria.maxWindSpeed} m/s (${(spot.criteria.maxWindSpeed * 3.6).toFixed(1)} km/h), from ${spot.criteria.windFromStart}° → ${spot.criteria.windFromEnd}° clockwise.`,
    `Paired daylight data available on ${summary.availableDays}/14 days.`,
    "Model estimates: GFS Wave swell + ECMWF IFS wind via Open-Meteo. Distant forecasts can change; this is not a surf observation.",
  ].join("\n");
  const url = new URL(publicUrl);
  url.searchParams.set("alert", spot.id);
  return { text, url: url.toString(), dates, confirmation, confirmedDates: [...new Set([...watch.confirmedDates, ...near])] };
};

export const createMonitor = ({ store, telegram, publicUrl, load = loadForecastAlerts, clock = Date.now,
  report = (event: string) => process.stdout.write(`${event}\n`) }: Readonly<{
    store: AlertStore; telegram: Telegram; publicUrl: string; load?: ForecastLoader; clock?: () => number; report?: (event: string) => void;
  }>) => {
  const holder = secret();
  let running = false;
  let nextPrune = 0;
  let pollRetryAt = 0;
  let pollFailures = 0;
  let lastPollAt = 0;
  let lastCycleAt = 0;
  const tick = async (signal: AbortSignal = new AbortController().signal): Promise<void> => {
    if (running || signal.aborted || !store.lease(holder, clock())) return;
    running = true;
    try {
      if (clock() >= pollRetryAt) {
        try {
          const updates = await telegram.updates(store.offset(), signal);
          for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) store.applyUpdate(update, clock());
          lastPollAt = clock(); pollFailures = 0;
        } catch {
          if (signal.aborted) return;
          pollRetryAt = clock() + Math.min(300_000, 5000 * 2 ** Math.min(6, pollFailures++));
          report("Aer Telegram: update polling unavailable; backing off");
        }
      }
      if (signal.aborted || !store.lease(holder, clock())) return;
      const watches = store.due(clock());
      if (watches.length) {
        let checks: readonly ForecastAlertCheck[] = [];
        try { checks = await load(watches.map((watch) => watch.spot), new Date(clock())); }
        catch { report("Aer Telegram: forecast batch unavailable"); }
        for (let i = 0; i < watches.length; i++) {
          const watch = watches[i];
          const check = checks[i];
          const summary = check?.ok && check.id === watch.spot.id ? check.summary : null;
          const notification = summary ? notificationFor(watch, summary, clock(), publicUrl) : null;
          store.checked(watch, summary, clock(), notification ?? undefined);
        }
      }
      if (signal.aborted || !store.lease(holder, clock())) return;
      for (const delivery of store.pending(clock())) {
        if (signal.aborted || !store.lease(holder, clock())) break;
        if (!store.beginDelivery(delivery, clock())) continue;
        const result = await telegram.send(delivery.chat_id, delivery.text, delivery.url ?? undefined);
        store.delivered(delivery, result, clock());
        report(`Aer Telegram: delivery ${result.kind}`);
      }
      lastCycleAt = clock();
      if (clock() >= nextPrune) { store.prune(clock()); nextPrune = clock() + 86_400_000; }
    } finally { running = false; }
  };
  return {
    tick,
    health: () => ({ lastPollAt: lastPollAt || null, lastCycleAt: lastCycleAt || null, pollingFailures: pollFailures }),
    async run(signal: AbortSignal): Promise<void> {
      try {
        while (!signal.aborted) {
          try { await tick(signal); } catch { report("Aer Telegram: background cycle failed; retrying"); }
          if (!signal.aborted) await new Promise<void>((resolve) => {
            const end = () => { clearTimeout(timer); signal.removeEventListener("abort", end); resolve(); };
            const timer = setTimeout(end, 1000); signal.addEventListener("abort", end, { once: true });
          });
        }
      } finally { store.release(holder); }
    },
  };
};

import { conditionSource } from "../../src/history.ts";
import { linkedSpotGroup } from "../../src/spot-links.ts";
import { alertRulesFor } from "../../src/alert-rules.ts";
import { evaluateForecastRules, forecastPeriodLabel, forecastSources, loadForecastAlerts, type ForecastAlertCheck, type ForecastAlertSummary } from "../../src/forecast-alerts.ts";
import type { SavedSpot } from "../../src/saved-spots.ts";
import { secret, type AlertStore, type WatchedSpot } from "./store.ts";
import type { Telegram } from "./telegram.ts";

type ForecastLoader = (spots: readonly SavedSpot[], now: Date, catalog?: readonly SavedSpot[]) => Promise<readonly ForecastAlertCheck[]>;

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
  const members = linkedSpotGroup(spot, watch.catalog ?? []).spots;
  const sources = forecastSources(members);
  const title = confirmation ? "Closer-range forecast confirmation" : near.length ? "Forecast matches" : "Early forecast heads-up";
  const text = [
    `${spot.name} — ${title}`,
    `Searching the next ${summary.horizonDays} local days; ${evaluation.linked.length ? "each point must pass one of its rules" : "any rule can trigger"}:`,
    ...evaluation.rules.map((rule) => `${rule.met ? "Met" : "Not met"}: ${rule.matchingDays} matching days in a ${rule.withinDays}-day period; need ${rule.minDays}.${rule.bestPeriod ? ` ${forecastPeriodLabel(rule.bestPeriod)}.` : " No complete period fits the look-ahead."}`),
    ...evaluation.linked.map((peer) => `Linked: ${peer.name} — ${peer.evaluation.matched ? "met" : "not met"}; ${peer.evaluation.rules.map((rule) => `${rule.matchingDays} matching days, need ${rule.minDays} in any ${rule.withinDays} days`).join(" or ")}.`),
    ...(evaluation.linked.length ? ["All linked conditions match during the same hours and dates."] : []),
    `At least ${summary.requiredHours} consecutive hourly samples, between 06:00 and 18:00.`,
    ...evaluation.windows.map((window) => `${dateText(window.start, summary.timezone)}–${clockText(window.end, summary.timezone)}`),
    `Local time: ${summary.timezone}.`,
    ...members.flatMap((member) => [
      ...(members.length > 1 ? [member.name + ":"] : []),
      ...(conditionSource(member.criteria) === "wind" ? [] : [
        `Swell ${member.criteria.minSwellHeight}–${member.criteria.maxSwellHeight} m; period ${member.criteria.minSwellPeriod}–${member.criteria.maxSwellPeriod ?? "unlimited"} s.`,
        `Swell from ${member.criteria.swellFromStart}° → ${member.criteria.swellFromEnd}° clockwise.`]),
      ...(conditionSource(member.criteria) === "swell" ? [] : [
        `Wind ≤${member.criteria.maxWindSpeed} m/s (${(member.criteria.maxWindSpeed * 3.6).toFixed(1)} km/h), from ${member.criteria.windFromStart}° → ${member.criteria.windFromEnd}° clockwise.`]),
    ]),
    `Selected daylight data available on ${summary.availableDays}/${summary.horizonDays} days.`,
    `Model estimates: ${sources.label} via Open-Meteo. ${sources.coverage} Distant forecasts can change; this is not a surf observation.`,
  ].join("\n");
  const url = new URL(publicUrl);
  url.searchParams.set("alert", spot.id);
  return { text, url: url.toString(), dates, confirmation, confirmedDates: [...new Set([...watch.confirmedDates, ...near])] };
};

export const createMonitor = ({ store, telegram, publicUrl, load = (spots, now, catalog) => loadForecastAlerts(spots, now, fetch, catalog), clock = Date.now,
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
        // IDs belong to an installation. Never resolve links using another owner's presets.
        for (const owner of new Set(watches.map((watch) => watch.owner))) {
          const batch = watches.filter((watch) => watch.owner === owner);
          let checks: readonly ForecastAlertCheck[] = [];
          try { checks = await load(batch.map((watch) => watch.spot), new Date(clock()), batch[0].catalog); }
          catch { report("Aer Telegram: forecast batch unavailable"); }
          for (let i = 0; i < batch.length; i++) {
            const watch = batch[i];
            const check = checks[i];
            const summary = check?.ok && check.id === watch.spot.id ? check.summary : null;
            const notification = summary ? notificationFor(watch, summary, clock(), publicUrl) : null;
            store.checked(watch, summary, clock(), notification ?? undefined);
          }
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

/** A rule can match any consecutive calendar-day period inside the forecast search horizon. */
export type AlertDayRule = Readonly<{ minDays: number; withinDays: number }>;
export type AlertRuleSettings = Readonly<{
  /** Legacy single threshold; retained for existing browser and server snapshots. */
  alertMinDays: number;
  alertRules?: readonly AlertDayRule[];
}>;

export const maxForecastDays = 14;
export const forecastLookAhead = (settings: Readonly<{ alertLookAheadDays?: number }>): number =>
  settings.alertLookAheadDays ?? maxForecastDays;
export const validForecastLookAhead = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maxForecastDays;

export const maxAlertRules = 14;
export const validAlertRules = (value: unknown): value is readonly AlertDayRule[] =>
  Array.isArray(value) && value.length > 0 && value.length <= maxAlertRules && value.every((rule) =>
    typeof rule === "object" && rule !== null && Number.isInteger(rule.minDays) && Number.isInteger(rule.withinDays) &&
    rule.minDays >= 1 && rule.minDays <= rule.withinDays && rule.withinDays <= 14);

export const alertRulesFor = (settings: AlertRuleSettings): readonly AlertDayRule[] =>
  settings.alertRules ?? [{ minDays: settings.alertMinDays, withinDays: 14 }];

export const alertRulesLabel = (settings: AlertRuleSettings): string =>
  alertRulesFor(settings).map((rule) => `${rule.minDays} days in any ${rule.withinDays}-day period`).join(" or ");

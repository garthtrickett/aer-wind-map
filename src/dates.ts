/** User-facing dates are always day/month/year; stored dates remain ISO calendar days. */
export const displayDay = (day: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : day;
};

export const displayMonth = (month: string): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  return match ? `${match[2]}/${match[1]}` : month;
};

export const parseDisplayDay = (text: string): string | null => {
  // Numeric phone keyboards can enter DDMMYYYY without needing a slash key.
  const normalized = text.trim().replace(/^(\d{2})(\d{2})(\d{4})$/, "$1/$2/$3");
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (!match) return null;
  const day = `${match[3]}-${match[2]}-${match[1]}`;
  const instant = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === day ? day : null;
};

export const displayDate = (instant: Date | number, timeZone?: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(instant);

export const displayDateTime = (instant: Date | number, timeZone?: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(instant);

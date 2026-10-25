import assert from "node:assert/strict";
import test from "node:test";
import { displayDate, displayDateTime, displayDay, displayMonth, parseDisplayDay } from "./dates.ts";
import { forecastPeriodLabel } from "./forecast-alerts.ts";

test("date entry always interprets day before month and rejects impossible dates", () => {
  assert.equal(parseDisplayDay("03/04/2025"), "2025-04-03");
  assert.equal(parseDisplayDay("30/11/2025"), "2025-11-30");
  assert.equal(parseDisplayDay("30112025"), "2025-11-30");
  assert.equal(parseDisplayDay("29/02/2024"), "2024-02-29");
  for (const text of ["29/02/2025", "31/04/2025", "11/30/2025", "00/01/2025", "01/00/2025", "2025-11-30", "", "1/2/2025"]) {
    assert.equal(parseDisplayDay(text), null, text);
  }
});

test("displayed dates use DD/MM/YYYY without shifting a calendar day across timezones", () => {
  assert.equal(displayDay("2025-11-30"), "30/11/2025");
  assert.equal(displayMonth("2026-05"), "05/2026");
  const time = new Date("2025-11-30T23:30:00Z");
  assert.equal(displayDate(time, "Asia/Manila"), "01/12/2025");
  assert.equal(displayDate(time, "America/Los_Angeles"), "30/11/2025");
  assert.match(displayDateTime(time, "Asia/Manila"), /^01\/12\/2025, 07:30 /);
  assert.equal(forecastPeriodLabel({ startDay: "2025-12-30", endDay: "2026-01-02" }), "30/12/2025–02/01/2026");
});

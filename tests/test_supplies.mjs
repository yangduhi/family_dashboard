import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { schoolWeek, validateMonthlyCalendar, validateSupplies } from "../web/supplies.js";

const ready = JSON.parse(readFileSync(new URL("fixtures/supplies-today.json", import.meta.url)));

test("calendar validation binds every event to the displayed Seoul month", () => {
  const day = "2028-02-01";
  const event = { date: "2028-02-29", title: "음악 놀이", audience: "AGE_ONE" };
  const calendar = { month: "2028-02", status: "AVAILABLE", events: [event] };
  for (const audience of ["AGE_ONE", "INCLUDES_ONE", "SHARED", "OTHER", "UNCONFIRMED"]) {
    assert.ok(validateMonthlyCalendar({ ...calendar, events: [{ ...event, audience, time: "10:00" }] }, day));
  }
  for (const change of [{ date: "2028-03-01" }, { date: "2028-02-30" }, { time: "24:00" },
    { audience: "ALL" }, { rawText: "test" }]) {
    assert.equal(validateMonthlyCalendar({ ...calendar, events: [{ ...event, ...change }] }, day), false);
  }
  assert.equal(validateMonthlyCalendar(calendar, "2028-03-01"), false);
  assert.equal(validateMonthlyCalendar({ ...calendar, status: "PENDING" }, day), false);
  assert.ok(validateMonthlyCalendar({ ...calendar, status: "PENDING", events: [] }, day));
});

test("Seoul school weeks span Monday to Friday across the year boundary", () => {
  const week = ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"];
  for (const target of week) {
    assert.deepEqual(schoolWeek(target, new Date(target + "T19:59:59+09:00")), week);
  }
  const upcoming = ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"];
  assert.deepEqual(schoolWeek("2027-01-01", new Date("2027-01-01T11:00:00Z")), upcoming);
  for (const target of ["2027-01-02", "2027-01-03", "2027-01-04"]) {
    assert.deepEqual(schoolWeek(target, new Date(target + "T00:00:00+09:00")), upcoming);
  }
});

test("activity supplies carry their own deadline and explicit age-one participation", () => {
  const event = {date: "2027-01-01", title: "김장 활동", audience: "SHARED",
    ageOneParticipation: "CONFIRMED", preparations: [{label: "어린이 위생장갑"}, {label: "앞치마", dueDate: "2026-12-30"}]};
  const valid = row => validateMonthlyCalendar({month: "2027-01", status: "NEEDS_REVIEW", events: [row]}, "2026-12-31", 1);
  assert.ok(valid(event));
  for (const change of [{ageOneParticipation: true}, {ageOneParticipation: "UNKNOWN"}, {audience: "OTHER"},
    {preparations: []}, {preparations: null}, {preparations: [{label: " "}]}, {preparations: [{label: "가".repeat(161)}]},
    {preparations: [{label: "옷", dueDate: "2026-02-30"}]}, {preparations: [{label: "옷", rawText: "x"}]},
    {preparations: [{label: "옷", dueDate: "2026-12-30"}, {dueDate: "2026-12-30", label: "옷"}]},
    {preparations: Array.from({length: 26}, (_, i) => ({label: String(i)}))}]) {
    assert.equal(valid({...event, ...change}), false);
  }
});

test("does not assign a rolled-over bulletin date to an unrelated weekday", () => {
  const row = { kind: "PREPARATION", title: "여벌 옷", detail: "", status: "VERIFIED",
    sourceDate: ready.targetDate, date: "2027-02-29" };
  assert.equal(validateSupplies({ ...ready, bulletins: [row] }), false);
});

test("accepts the versioned same-day contract and explicit empty or partial states", () => {
  assert.equal(validateSupplies(ready), true);
  assert.equal(validateSupplies({ ...ready, state: "EMPTY", items: [] }), true);
  assert.equal(validateSupplies({ ...ready, state: "NEEDS_REVIEW", complete: false }), true);
});

test("rejects stale dates and misleading or invalid API results", () => {
  for (const fields of [
    { targetDate: "2026-11-20" },
    { serverNow: "2026-11-20T22:00:00" },
    { state: "READY", items: [] },
    { state: "EMPTY", complete: false, items: [] },
    { state: "AUTH_REQUIRED", complete: false },
    { checkedAt: null },
    { items: [{ ...ready.items[0], applicableDate: "2026-11-20" }] },
    { items: [{ ...ready.items[0], sourceType: "unknown" }] },
    { state: "toString" },
  ]) assert.equal(validateSupplies({ ...ready, ...fields }), false, JSON.stringify(fields));
});

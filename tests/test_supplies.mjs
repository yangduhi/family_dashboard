import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { schoolWeek, validateSupplies } from "../web/supplies.js";

const ready = JSON.parse(readFileSync(new URL("fixtures/supplies-today.json", import.meta.url)));

test("Seoul school weeks span Monday to Friday across the year boundary", () => {
  const week = ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"];
  for (const target of [week[0], week[4], "2027-01-02", "2027-01-03"]) {
    assert.deepEqual(schoolWeek(target), week);
  }
  assert.deepEqual(schoolWeek("2027-01-03", true), schoolWeek("2027-01-04"));
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

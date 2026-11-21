import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSupplies } from "../web/supplies.js";

const ready = JSON.parse(readFileSync(new URL("fixtures/supplies-today.json", import.meta.url)));

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

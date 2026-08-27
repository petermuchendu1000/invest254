import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMpesaResult, isTransientProviderCode } from "./mpesa.js";

test("code 0 is the only success", () => {
  const r = classifyMpesaResult(0);
  assert.equal(r.paid, true);
  assert.equal(r.category, "paid");
  assert.equal(r.retriable, false);
});

test("provider-side transient faults are classified as provider_down + retriable + non-blaming", () => {
  for (const code of [17, 26, 1025, 9999]) {
    const r = classifyMpesaResult(code);
    assert.equal(r.category, "provider_down", `code ${code}`);
    assert.equal(r.retriable, true, `code ${code}`);
    assert.equal(r.paid, false, `code ${code}`);
    assert.ok(/Safaricom/i.test(r.userMessage), `code ${code} message names provider`);
    assert.ok(/No money was deducted/i.test(r.userMessage), `code ${code} reassures no debit`);
    assert.ok(isTransientProviderCode(code), `code ${code} is transient`);
  }
});

test("the code 17 storm from the incident does NOT blame the user", () => {
  const r = classifyMpesaResult(17);
  // Must not repeat the old misleading copy that blamed the user for a Safaricom outage.
  assert.ok(!/you cancelled/i.test(r.userMessage));
  assert.ok(!/wasn.t approved/i.test(r.userMessage));
});

test("user-actionable codes map to the right category", () => {
  assert.equal(classifyMpesaResult(1).category, "insufficient");
  assert.equal(classifyMpesaResult(1032).category, "cancelled");
  assert.equal(classifyMpesaResult(1037).category, "unreachable");
  assert.equal(classifyMpesaResult(2001).category, "wrong_pin");
  assert.equal(classifyMpesaResult(2035).category, "invalid_number");
  assert.equal(classifyMpesaResult(1001).category, "in_progress");
});

test("invalid number is terminal (not retriable); insufficient/cancelled are retriable", () => {
  assert.equal(classifyMpesaResult(2035).retriable, false);
  assert.equal(classifyMpesaResult(1).retriable, true);
  assert.equal(classifyMpesaResult(1032).retriable, true);
});

test("unknown codes fall back to a safe, honest, retriable generic message", () => {
  const r = classifyMpesaResult(424242);
  assert.equal(r.category, "unknown");
  assert.equal(r.retriable, true);
  assert.equal(r.paid, false);
  assert.ok(/No money was deducted/i.test(r.userMessage));
  assert.equal(isTransientProviderCode(424242), false);
});

test("no non-zero code is ever marked paid", () => {
  for (const code of [1, 17, 26, 1001, 1025, 1032, 1037, 2001, 2035, 4999, 9999, 11]) {
    assert.equal(classifyMpesaResult(code).paid, false, `code ${code}`);
  }
});

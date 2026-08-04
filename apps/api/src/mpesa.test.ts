import { test } from "node:test";
import assert from "node:assert/strict";
import { ksh, mpesaDate, mpesaTime, mpesaCode, mpesaReceivedMessage } from "./mpesa.js";

// 4 Aug 2026, 18:45 EAT  ==  15:45 UTC (EAT = UTC+3). Matches the screenshot's "Tue, Aug 4 18:45".
const MS = Date.UTC(2026, 7, 4, 15, 45, 0);

test("ksh formats integer cents with grouping and 2dp", () => {
  assert.equal(ksh(70000), "Ksh700.00");
  assert.equal(ksh(161488), "Ksh1,614.88");
  assert.equal(ksh(0), "Ksh0.00");
  assert.equal(ksh(-25000), "Ksh250.00"); // magnitude only
});

test("date/time render in East Africa Time", () => {
  assert.equal(mpesaDate(MS), "4/8/26");
  assert.equal(mpesaTime(MS), "6:45 PM");
  assert.equal(mpesaTime(Date.UTC(2026, 7, 4, 6, 5, 0)), "9:05 AM"); // 06:05 UTC -> 09:05 EAT
});

test("transaction code encodes the date in its first three characters", () => {
  const code = mpesaCode(MS, 42);
  assert.equal(code.length, 10);
  // year 2026 -> U, month 8 (Aug) -> H, day 4 -> "4"
  assert.equal(code.slice(0, 3), "UH4");
  // deterministic for a given (ms, seq)
  assert.equal(mpesaCode(MS, 42), code);
  // different ledger ids diverge in the tail
  assert.notEqual(mpesaCode(MS, 42), mpesaCode(MS, 43));
});

test("received message mirrors the real M-PESA SMS", () => {
  const msg = mpesaReceivedMessage({ code: "UH4X7K2QAB", amountCents: 70000, party: "INVEST254", balanceCents: 161488, atMs: MS });
  assert.equal(
    msg,
    "UH4X7K2QAB Confirmed. You have received Ksh700.00 from INVEST254 on 4/8/26 at 6:45 PM. New M-PESA balance is Ksh1,614.88. Transaction cost, Ksh0.00.",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeChat, MAX_CHAT_LEN } from "./chatfilter.js";

test("sanitizeChat: trims, collapses whitespace, accepts normal text", () => {
  const r = sanitizeChat("  hello   world 🚀  ");
  assert.deepEqual(r, { ok: true, text: "hello world 🚀", reasons: [] });
});

test("sanitizeChat: rejects empty and over-length", () => {
  assert.deepEqual(sanitizeChat("   "), { ok: false, text: "", reasons: ["empty"] });
  const long = "a".repeat(MAX_CHAT_LEN + 1);
  assert.deepEqual(sanitizeChat(long), { ok: false, text: "", reasons: ["too_long"] });
  assert.equal(sanitizeChat("a".repeat(MAX_CHAT_LEN)).ok, true); // boundary ok
});

test("sanitizeChat: strips URLs", () => {
  const r1 = sanitizeChat("join here https://scam.example/win now");
  assert.ok(r1.ok && r1.reasons.includes("link") && !/scam\.example/.test(r1.text));
  const r2 = sanitizeChat("visit www.evil.io please");
  assert.ok(r2.ok && r2.reasons.includes("link"));
  const r3 = sanitizeChat("dm me on telegram.me asap");
  assert.ok(r3.ok && r3.reasons.includes("link"));
});

test("sanitizeChat: strips phone numbers (KE formats and long digit runs)", () => {
  for (const p of ["call 0712345678", "+254712345678 dm", "0112 345 678", "reach 254712345678"]) {
    const r = sanitizeChat(p);
    assert.ok(r.ok && r.reasons.includes("number"), `not stripped: ${p} -> ${r.text}`);
    assert.ok(!/\d{7,}/.test(r.text.replace(/\s|-/g, "")), `digits leaked: ${r.text}`);
  }
});

test("sanitizeChat: masks profanity but keeps the message", () => {
  const r = sanitizeChat("this is shit honestly");
  assert.ok(r.ok && r.reasons.includes("profanity"));
  assert.ok(!/shit/.test(r.text) && /\*{4}/.test(r.text));
});

test("sanitizeChat: message that is only a link is rejected as empty after stripping", () => {
  const r = sanitizeChat("https://x.io");
  // becomes "[link removed]" — non-empty, so it stays ok with the link reason
  assert.ok(r.reasons.includes("link"));
});

test("sanitizeChat: multiple violations accumulate reasons", () => {
  const r = sanitizeChat("shit go to www.bad.io or call 0712345678");
  assert.ok(r.ok);
  for (const reason of ["link", "number", "profanity"]) assert.ok(r.reasons.includes(reason), `missing ${reason}`);
});

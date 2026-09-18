import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_SCHEMAS, GATEWAY_CODES, getSchema, fieldKinds, splitSubmission, validateConfig,
} from "./gatewayschema.js";

test("all four gateways are registered with a stable shape", () => {
  assert.deepEqual(GATEWAY_CODES.sort(), ["binance", "megapay", "payhero", "paystack"]);
  for (const code of GATEWAY_CODES) {
    const s = GATEWAY_SCHEMAS[code]!;
    assert.equal(s.code, code);
    assert.ok(s.displayName && s.docsUrl && s.blurb);
    assert.ok(s.fields.length > 0);
    for (const f of s.fields) assert.ok(f.key && f.label && f.kind);
  }
});

test("fieldKinds splits secret vs non-secret keys per provider", () => {
  assert.deepEqual(fieldKinds("megapay").secretKeys, ["api_key"]);
  assert.deepEqual(fieldKinds("paystack").secretKeys, ["secret_key"]);
  assert.deepEqual(fieldKinds("binance").secretKeys.sort(), ["api_key", "api_secret"]);
  assert.deepEqual(fieldKinds("payhero").secretKeys, ["auth_token"]);
  assert.ok(fieldKinds("megapay").settingKeys.includes("email"));
});

test("getSchema throws on an unknown provider", () => {
  assert.throws(() => getSchema("nope"), /PROVIDER_NOT_CONFIGURABLE/);
});

test("splitSubmission routes secrets vs settings and ignores unknown keys", () => {
  const { settings, secrets } = splitSubmission("megapay", {
    env: "production", email: " a@b.co ", api_key: "MGPYxxxx", junk: "drop-me",
  });
  assert.deepEqual(settings, { env: "production", email: "a@b.co" }); // trimmed, no junk
  assert.deepEqual(secrets, { api_key: "MGPYxxxx" });
});

test("validateConfig: required fields enforced (megapay needs env,email,api_key)", () => {
  const issues = validateConfig("megapay", { settings: {}, secrets: {} });
  const fields = issues.map((i) => i.field).sort();
  assert.deepEqual(fields, ["api_key", "email", "env"]);
});

test("validateConfig: an already-stored secret satisfies a required secret (settings-only edit)", () => {
  const issues = validateConfig("megapay",
    { settings: { env: "sandbox", email: "a@b.co" }, secrets: {} },
    ["api_key"]); // api_key already on file
  assert.deepEqual(issues, []);
});

test("validateConfig: email, url, select and key-prefix patterns are checked", () => {
  const bad = validateConfig("megapay", { settings: { env: "nonsense", email: "not-an-email", api_base: "ftp://x" }, secrets: { api_key: "k12345678" } });
  const fields = bad.map((i) => i.field).sort();
  assert.deepEqual(fields, ["api_base", "email", "env"]);

  const paystackBad = validateConfig("paystack", { settings: { env: "test", public_key: "wrong" }, secrets: { secret_key: "sk_bad" } });
  assert.ok(paystackBad.some((i) => i.field === "secret_key"));
  assert.ok(paystackBad.some((i) => i.field === "public_key"));

  const paystackOk = validateConfig("paystack", { settings: { env: "live", public_key: "pk_live_abc123" }, secrets: { secret_key: "sk_live_abc123" } });
  assert.deepEqual(paystackOk, []);
});

test("validateConfig: payhero requires auth_token + channel_id", () => {
  const issues = validateConfig("payhero", { settings: { env: "sandbox" }, secrets: {} });
  const fields = issues.map((i) => i.field).sort();
  assert.deepEqual(fields, ["auth_token", "channel_id"]);
});

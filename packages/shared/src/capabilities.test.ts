import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, ALL_CAPABILITIES, can } from "./capabilities.js";

test("docs/42: can() fails closed for unknown/missing roles", () => {
  for (const cap of ALL_CAPABILITIES) {
    assert.equal(can(undefined, cap), false);
    assert.equal(can("", cap), false);
    assert.equal(can("superadmin", cap), false, `the removed legacy tier gets nothing (${cap})`);
    assert.equal(can("platform_superadmin ", cap), false, "no fuzzy matching");
  }
});

test("docs/42 UI-3: an impersonated brand session ('admin') never holds an owner-only capability", () => {
  for (const cap of ["backoffice.governance", "backoffice.audit", "backoffice.logs", "backoffice.users.overrides_write",
    "backoffice.users.set_role_admin", "backoffice.users.delete_admin", "console.enter", "console.system"] as const) {
    assert.equal(can("admin", cap), false, cap);
  }
});

test("docs/42: players and marketers hold no operator capability; every capability has at least one tier", () => {
  for (const cap of ALL_CAPABILITIES) {
    assert.equal(can("player", cap), false, cap);
    assert.equal(can("marketer", cap), false, cap);
    assert.ok(CAPABILITIES[cap].length > 0, cap);
  }
  assert.equal(can("platform_admin", "backoffice.enter"), false, "a raw platform admin works a brand only by opening it");
});

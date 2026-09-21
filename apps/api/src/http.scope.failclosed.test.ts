import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminScopeSite, adminScopePlatform, assertTargetSiteInScope, assertTargetPlatformInScope,
  ApiError, type Ctx,
} from "./http.js";

/**
 * Regression coverage for audit finding 03 (cross-tenant scope widening) — docs/39 §3.
 *
 * Every scope primitive in http.ts returned `null` for a MISSING scope key, and `null` is the
 * sentinel this module reserves for "unrestricted" (the system owner). A platform_admin whose token
 * carried no `platform` claim was therefore treated as system-wide -- which is how @thegenius, an
 * admin of platform `nduati` (one brand), reached invest254 and tamutraders inside @zrinok's
 * platform and minted admin tokens for them (admin_actions, 2026-09-21 17:25-17:28 UTC).
 *
 * Contract pinned here: a missing or unresolvable scope key is REFUSED, never widened.
 */
const P1 = "10000000-0000-0000-0000-000000000001";
const SA = "00000000-0000-0000-0000-0000000000a1";
const ctx = (claims: Record<string, unknown> | undefined): Ctx => ({ claims } as unknown as Ctx);

function caught(fn: () => unknown): ApiError | undefined {
  try { fn(); return undefined; } catch (e) { return e as ApiError; }
}

test("adminScopePlatform: a platform_admin WITHOUT a platform claim is refused (fail closed)", () => {
  const err = caught(() => adminScopePlatform(ctx({ userId: "u", role: "platform_admin" })));
  assert.ok(err instanceof ApiError, "must throw, not return null (= unrestricted)");
  assert.equal(err!.code, "PLATFORM_SCOPE_REQUIRED");
  assert.equal(err!.status, 403);
  const err2 = caught(() => adminScopePlatform(ctx({ userId: "u", role: "platform_admin", platform: "" })));
  assert.ok(err2 instanceof ApiError, "an empty platform claim is equally unscopable");
});

test("adminScopePlatform: a correctly minted platform_admin still gets its platform", () => {
  assert.equal(adminScopePlatform(ctx({ userId: "u", role: "platform_admin", platform: P1 })), P1);
});

test("adminScopePlatform: the system owner remains unrestricted", () => {
  assert.equal(adminScopePlatform(ctx({ userId: "u", role: "platform_superadmin" })), null);
});

test("adminScopeSite: a site admin WITHOUT a site claim is refused (fail closed)", () => {
  for (const role of ["admin", "superadmin"]) {
    const err = caught(() => adminScopeSite(ctx({ userId: "u", role })));
    assert.ok(err instanceof ApiError, `${role} with no site claim must throw`);
    assert.equal(err!.code, "SITE_SCOPE_REQUIRED");
    assert.equal(err!.status, 403);
  }
});

test("adminScopeSite: a correctly scoped site admin still gets its brand", () => {
  assert.equal(adminScopeSite(ctx({ userId: "u", role: "admin", site: SA })), SA);
});

test("assertTargetPlatformInScope: bounded caller + unresolvable target fails closed", () => {
  const pa = ctx({ userId: "u", role: "platform_admin", platform: P1 });
  const err = caught(() => assertTargetPlatformInScope(pa, null));
  assert.ok(err instanceof ApiError, "must throw rather than defer");
  assert.equal(err!.code, "PLATFORM_SCOPE_FORBIDDEN");
  assert.equal(err!.status, 403);
  assert.doesNotThrow(() => assertTargetPlatformInScope(pa, P1), "in-scope target still passes");
});

test("assertTargetSiteInScope: bounded site admin + unresolvable target fails closed", () => {
  const a = ctx({ userId: "u", role: "admin", site: SA });
  const err = caught(() => assertTargetSiteInScope(a, null));
  assert.ok(err instanceof ApiError, "must throw rather than defer");
  assert.equal(err!.code, "SITE_SCOPE_FORBIDDEN");
  assert.doesNotThrow(() => assertTargetSiteInScope(a, SA), "in-brand target still passes");
});

test("the system owner is still never platform- or site-bounded", () => {
  const sys = ctx({ userId: "u", role: "platform_superadmin" });
  assert.doesNotThrow(() => assertTargetPlatformInScope(sys, null));
  assert.doesNotThrow(() => assertTargetPlatformInScope(sys, P1));
  assert.doesNotThrow(() => assertTargetSiteInScope(sys, null));
});

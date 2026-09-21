import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, TEST_ADMIN, SITE_A, type TestApi } from "./testutil.js";

/**
 * REGRESSION GUARD (Issue 1 — data leak, FIXED): @thegenius (platform_admin, platform "nduati") can reach
 * @zrinok's brand (invest254, default platform).
 *
 * Root cause: POST /auth/refresh mints the token via issueToken(userId, role) with NO platform arg,
 * so the `platform` claim is dropped. adminScopePlatform() then returns null for a platform_admin
 * ("unrestricted"), and scopeSiteParam waves the caller into ANY brand's impersonation mint.
 *
 * The dev verifier parses `userId:role:site:platform`. A token WITHOUT the 4th segment is exactly the
 * shape /auth/refresh produces. SITE_A belongs to the default platform.
 */
const OWNER = TEST_ADMIN;
const OTHER_PLATFORM = "99999999-9999-9999-9999-999999999999"; // a platform that does NOT own SITE_A

// Same operator, two token shapes for a platform_admin bound to OTHER_PLATFORM:
const WITH_CLAIM = `${OWNER}:platform_admin:${SITE_A}:${OTHER_PLATFORM}`; // pre-refresh (fenced)
const POST_REFRESH = `${OWNER}:platform_admin`;                          // post-refresh (claim stripped)

function impersonate(api: TestApi, token: string): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/platform/sites/${SITE_A}/impersonate`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

test("CONTROL: a claim-scoped platform_admin of another platform is fenced from SITE_A (403)", async () => {
  const api = await startTestApi();
  try {
    const res = await impersonate(api, WITH_CLAIM);
    assert.equal(res.status, 403, "pre-refresh token must be refused (PLATFORM_SCOPE_FORBIDDEN)");
  } finally { await api.close(); }
});

test("LEAK: post-refresh platformless platform_admin must STILL be fenced from SITE_A", async () => {
  const api = await startTestApi();
  try {
    const res = await impersonate(api, POST_REFRESH);
    const body = await res.json().catch(() => ({}));
    // Secure expectation: the fence must hold even without a platform claim (fail-closed).
    assert.equal(
      res.status, 403,
      `LEAK CONFIRMED: platformless platform_admin got HTTP ${res.status} on a foreign brand ` +
      `(minted role='${(body as any).role}', site='${(body as any).site}'). Expected 403.`,
    );
  } finally { await api.close(); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, type TestApi } from "./testutil.js";

/**
 * Regression (min withdrawal): the admin game-config PATCH allowlist in app.admin.ts
 * (CONFIG_FIELDS / CONFIG_INT_FIELDS) once omitted `minWithdrawalCents`, so a save that
 * changed ONLY the minimum withdrawal was stripped to an empty patch and rejected with
 * "provide at least one config field to update" — the floor could never be edited from the
 * admin panel even though the DB RPC (0043) and engine both support it. This locks the field
 * into the allowlist so a min-withdrawal-only save persists and reads back.
 */

const json = (res: Response): Promise<any> => res.json() as Promise<any>;

interface ReqOpts { token?: string; body?: unknown }
function req(api: TestApi, method: string, path: string, opts: ReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  return fetch(`${api.baseUrl}${path}`, init);
}

test("admin game-config: minWithdrawalCents is editable (regression: allowlist dropped it -> empty patch 400)", async () => {
  const api = await startTestApi();
  try {
    // A min-withdrawal-ONLY patch must be accepted (previously stripped to an empty patch).
    const upd = await req(api, "PATCH", "/api/v1/admin/game-config", { token: "root:superadmin", body: { minWithdrawalCents: 50_000 } });
    assert.equal(upd.status, 200, "min-withdrawal-only patch must be accepted, not rejected as an empty patch");
    const u = await json(upd);
    assert.equal(u.minWithdrawalCents, 50_000);
    assert.equal(u.minStakeCents, 25_000); // untouched key preserved

    // GET reflects the saved floor.
    const cfg = await json(await req(api, "GET", "/api/v1/admin/game-config", { token: "root:superadmin" }));
    assert.equal(cfg.minWithdrawalCents, 50_000);

    // Integer-cents guard: a fractional floor is rejected (minWithdrawalCents is an int field).
    assert.equal((await req(api, "PATCH", "/api/v1/admin/game-config", { token: "root:superadmin", body: { minWithdrawalCents: 100.5 } })).status, 400);

    // A day-to-day admin still cannot edit config (superadmin only).
    assert.equal((await req(api, "PATCH", "/api/v1/admin/game-config", { token: "admin-1:admin", body: { minWithdrawalCents: 30_000 } })).status, 403);
  } finally {
    await api.close();
  }
});

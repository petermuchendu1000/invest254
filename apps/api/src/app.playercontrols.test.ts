import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, type TestApi } from "./testutil.js";

const json = (res: Response): Promise<any> => res.json() as Promise<any>;
interface ReqOpts { token?: string; body?: unknown; }
function req(api: TestApi, method: string, path: string, opts: ReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  return fetch(`${api.baseUrl}${path}`, init);
}
async function register(api: TestApi, phone: string, username: string): Promise<string> {
  const res = await req(api, "POST", "/api/v1/auth/register", { body: { phone, username, password: "Password1" } });
  assert.equal(res.status, 201, `register ${username}`);
  return (await json(res)).userId as string;
}

test("admin sets/reads per-user overrides; validates ranges; player forbidden", async () => {
  const api = await startTestApi();
  try {
    const uid = await register(api, "0712500001", "ov_target");

    // defaults are all-null before anything is set
    const before = await json(await req(api, "GET", `/api/v1/admin/users/${uid}/overrides`, { token: "admin-1:admin" }));
    assert.equal(before.winRate, null);
    assert.equal(before.tradeDurationS, null);

    // set a feasible win rate + forced duration + a per-user cap and stake bounds
    const set = await req(api, "POST", `/api/v1/admin/users/${uid}/overrides`, {
      token: "admin-1:admin",
      body: { winRate: 0.2, tradeDurationS: 30, maxWinMultiplier: 4, minStakeCents: 20000, maxStakeCents: 500000, notes: "VIP" },
    });
    assert.equal(set.status, 200);
    const row = await json(set);
    assert.equal(row.winRate, 0.2);
    assert.equal(row.tradeDurationS, 30);
    assert.equal(row.maxWinMultiplier, 4);

    // read back
    const got = await json(await req(api, "GET", `/api/v1/admin/users/${uid}/overrides`, { token: "admin-1:admin" }));
    assert.equal(got.minStakeCents, 20000);
    assert.equal(got.notes, "VIP");

    // clear a field back to global by sending null
    const cleared = await json(await req(api, "POST", `/api/v1/admin/users/${uid}/overrides`, { token: "admin-1:admin", body: { winRate: null } }));
    assert.equal(cleared.winRate, null);
    assert.equal(cleared.tradeDurationS, 30, "other fields untouched");

    // validation: out-of-range winRate / duration -> 400
    assert.equal((await req(api, "POST", `/api/v1/admin/users/${uid}/overrides`, { token: "admin-1:admin", body: { winRate: 1.5 } })).status, 400);
    assert.equal((await req(api, "POST", `/api/v1/admin/users/${uid}/overrides`, { token: "admin-1:admin", body: { tradeDurationS: 0 } })).status, 400);
    assert.equal((await req(api, "POST", `/api/v1/admin/users/${uid}/overrides`, { token: "admin-1:admin", body: {} })).status, 400);

    // a player cannot set overrides
    assert.equal((await req(api, "POST", `/api/v1/admin/users/${uid}/overrides`, { token: uid, body: { winRate: 0.2 } })).status, 403);

    // audited
    const audit = await json(await req(api, "GET", "/api/v1/admin/audit", { token: "admin-1:admin" }));
    assert.ok(audit.items.some((a: any) => a.action === "user.overrides"));
  } finally { await api.close(); }
});

test("admin adjusts the bonus wallet and clears balances", async () => {
  const api = await startTestApi();
  try {
    const uid = await register(api, "0712500002", "bal_target");

    // credit the bonus wallet
    const credit = await req(api, "POST", `/api/v1/admin/wallets/${uid}/adjust`, { token: "fin-1:admin", body: { amountCents: 30000, kind: "bonus", reason: "welcome bonus" } });
    assert.equal(credit.status, 200);
    const cb = await json(credit);
    assert.equal(cb.kind, "bonus");
    assert.equal(cb.newBalanceCents, 30000);

    // credit the real wallet too
    await req(api, "POST", `/api/v1/admin/wallets/${uid}/adjust`, { token: "fin-1:admin", body: { amountCents: 50000, reason: "manual credit" } });

    // clear the bonus wallet only
    const clr = await req(api, "POST", `/api/v1/admin/wallets/${uid}/clear`, { token: "fin-1:admin", body: { kind: "bonus", reason: "expire bonus" } });
    assert.equal(clr.status, 200);
    const c = await json(clr);
    assert.equal(c.bonusBalanceCents, 0);
    assert.equal(c.realBalanceCents, 50000, "real wallet untouched when clearing bonus");

    // clear requires a reason
    assert.equal((await req(api, "POST", `/api/v1/admin/wallets/${uid}/clear`, { token: "fin-1:admin", body: { kind: "both" } })).status, 400);

    // both -> zeroes real too
    const both = await json(await req(api, "POST", `/api/v1/admin/wallets/${uid}/clear`, { token: "fin-1:admin", body: { kind: "both", reason: "reset" } }));
    assert.equal(both.realBalanceCents, 0);
    assert.equal(both.bonusBalanceCents, 0);
  } finally { await api.close(); }
});

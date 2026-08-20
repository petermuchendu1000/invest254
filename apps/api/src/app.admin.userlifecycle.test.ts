import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, SITE_A, SITE_B, type TestApi } from "./testutil.js";

/**
 * Task 1 HTTP surface: recoverable soft-delete + restore for users, and assign/move a marketer to
 * a brand. Proves gating, that deleted users are hidden by default but discoverable via
 * includeDeleted, restore round-trips, and a marketer moves brands (with PHONE_TAKEN enforced).
 */
const json = (r: Response): Promise<any> => r.json() as Promise<any>;
interface ReqOpts { token?: string; body?: unknown; }
function req(api: TestApi, method: string, path: string, opts: ReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  return fetch(`${api.baseUrl}${path}`, init);
}
function sub(token: string): string {
  const seg = token.split(".")[1]!;
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8")).sub as string;
}

const ADMIN = "u-admin:superadmin";          // no site claim -> unrestricted (platform-style) admin
const listUsers = async (api: TestApi, qs = "") =>
  (await json(await req(api, "GET", `/api/v1/admin/users${qs}`, { token: ADMIN }))).items as any[];

test("user soft-delete: gating, hide-by-default, restore", async () => {
  const api = await startTestApi();
  try {
    const reg = await json(await req(api, "POST", "/api/v1/auth/register", { body: { phone: "0712345678", username: "alice", password: "Password1", site: "invest254" } }));
    const uid = sub(reg.token);
    const playerTok = `${uid}:player`;

    // gating: a player cannot delete anyone.
    assert.equal((await req(api, "POST", `/api/v1/admin/users/${uid}/delete`, { token: playerTok, body: { reason: "x" } })).status, 403);

    // present in the default list before deletion.
    assert.ok((await listUsers(api)).some((u) => u.userId === uid), "user listed before delete");

    // admin deletes -> banned + deletedAtMs stamped.
    const del = await req(api, "POST", `/api/v1/admin/users/${uid}/delete`, { token: ADMIN, body: { reason: "fraud" } });
    assert.equal(del.status, 200);
    const delBody = await json(del);
    assert.equal(delBody.status, "banned");
    assert.ok(typeof delBody.deletedAtMs === "number");

    // hidden from the default list, visible with includeDeleted (with deletedAtMs set).
    assert.equal((await listUsers(api)).some((u) => u.userId === uid), false, "hidden by default after delete");
    const withDeleted = await listUsers(api, "?includeDeleted=true");
    const row = withDeleted.find((u) => u.userId === uid);
    assert.ok(row && typeof row.deletedAtMs === "number", "visible with includeDeleted + deletedAtMs");

    // restore -> reappears, active.
    const res = await req(api, "POST", `/api/v1/admin/users/${uid}/restore`, { token: ADMIN });
    assert.equal(res.status, 200);
    assert.equal((await json(res)).status, "active");
    assert.ok((await listUsers(api)).some((u) => u.userId === uid), "listed again after restore");
  } finally { await api.close(); }
});

test("marketer move: cross-brand reassignment + PHONE_TAKEN on destination", async () => {
  const api = await startTestApi();
  try {
    const mk = await json(await req(api, "POST", "/api/v1/admin/marketers", { token: ADMIN, body: { name: "Peter", phone: "0733000001" } }));
    // move A -> B (unrestricted admin).
    const mv = await req(api, "PATCH", `/api/v1/admin/marketers/${mk.id}/site`, { token: ADMIN, body: { siteId: SITE_B } });
    assert.equal(mv.status, 200);

    // now visible under brand B, not brand A.
    const listB = await json(await req(api, "GET", "/api/v1/admin/marketers", { token: `u-admin:admin:${SITE_B}` }));
    const listA = await json(await req(api, "GET", "/api/v1/admin/marketers", { token: `u-admin:admin:${SITE_A}` }));
    assert.ok(listB.some((m: any) => m.id === mk.id), "moved marketer appears under brand B");
    assert.equal(listA.some((m: any) => m.id === mk.id), false, "no longer under brand A");

    // PHONE_TAKEN: a marketer with the same phone already exists on the destination.
    const dupA = await json(await req(api, "POST", "/api/v1/admin/marketers", { token: `u-admin:admin:${SITE_A}`, body: { name: "Dupe", phone: "0733000009" } }));
    await req(api, "POST", "/api/v1/admin/marketers", { token: `u-admin:admin:${SITE_B}`, body: { name: "Existing", phone: "0733000009" } });
    const conflict = await req(api, "PATCH", `/api/v1/admin/marketers/${dupA.id}/site`, { token: ADMIN, body: { siteId: SITE_B } });
    assert.equal(conflict.status, 409);
  } finally { await api.close(); }
});

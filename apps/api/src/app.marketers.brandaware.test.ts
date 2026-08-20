import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerToTxDto, type MarketerLedgerRow } from "./app.marketers.js";
import { startTestApi, type TestApi, SITE_B } from "./testutil.js";

const json = (res: Response): Promise<any> => res.json() as Promise<any>;

interface ReqOpts { token?: string; body?: unknown; }
function req(api: TestApi, method: string, path: string, opts: ReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  return fetch(`${api.baseUrl}${path}`, init);
}

const mtok = (id: string) => `${id}:marketer`;

// ── Unit: the counterparty on a game-withdrawal credit is the resolved brand (uppercased) ──
test("ledgerToTxDto: game-withdrawal party reflects the brand name", () => {
  const row: MarketerLedgerRow = {
    id: 42, entry_type: "credit", amount_cents: 70000, balance_after_cents: 70000,
    ref: "game:x", meta: { source: "game_withdrawal" }, created_at: new Date("2026-08-04T15:45:00Z").toISOString(),
  };
  // Non-default brand → its name, uppercased.
  const mad = ledgerToTxDto(row, "Madolar");
  assert.equal(mad.mpesa.party, "MADOLAR");
  assert.match(mad.mpesa.message, /You have received Ksh700\.00 from MADOLAR on /);
  // Default (unresolved) preserves the historical "INVEST254".
  const dflt = ledgerToTxDto(row);
  assert.equal(dflt.mpesa.party, "INVEST254");
  assert.match(dflt.mpesa.message, /from INVEST254 on /);
  // A non-game-withdrawal credit is unaffected by brandName (uses meta.name / "M-PESA").
  const other = ledgerToTxDto({ ...row, meta: { name: "John Doe" } }, "Madolar");
  assert.equal(other.mpesa.party, "JOHN DOE");
});

// ── e2e: a marketer on a NON-default brand sees that brand as the counterparty ──
test("marketer on Brand B: game-withdrawal reads 'from BRAND B', not INVEST254", async () => {
  const api = await startTestApi();
  try {
    // Admin token scoped to SITE_B → the marketer is created on Brand B.
    const adminB = `u-admin:admin:${SITE_B}`;
    const created = await json(await req(api, "POST", "/api/v1/admin/marketers", {
      token: adminB, body: { name: "Grace Wanjiru", phone: "0722555001" },
    }));
    const id = created.id as string;
    assert.equal((await req(api, "POST", `/api/v1/admin/marketers/${id}/pin`, { token: adminB, body: { pin: "1234" } })).status, 200);

    // Credit a game withdrawal into the Brand-B marketer's wallet.
    assert.equal((await req(api, "POST", `/api/v1/admin/marketers/${id}/credit`, {
      token: adminB, body: { amountCents: 70000, ref: "game:b1", meta: { source: "game_withdrawal" } },
    })).status, 200);

    const feed = await json(await req(api, "GET", "/api/v1/marketers/me/transactions", { token: mtok(id) }));
    assert.equal(feed.items.length, 1);
    const tx = feed.items[0];
    assert.equal(tx.mpesa.party, "BRAND B");
    assert.match(tx.mpesa.message, /You have received Ksh700\.00 from BRAND B on /);
  } finally { await api.close(); }
});

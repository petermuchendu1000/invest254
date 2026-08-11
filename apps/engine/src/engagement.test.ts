import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEngagementRepository, PgEngagementRepository, maskHandle } from "./engagement.js";
import type { Querier } from "./wallet.js";

test("maskHandle: keeps a prefix, masks the rest, handles short handles", () => {
  assert.equal(maskHandle("wanjiku_254"), "wanj***");
  assert.equal(maskHandle("joy"), "jo***"); // floor(3/2)=1 -> max(2,1)=2 -> keep 2
  assert.equal(maskHandle("ab"), "a***");
  assert.equal(maskHandle("a"), "***");
  assert.equal(maskHandle(""), "***");
});

test("InMemory engagement: activity insert + recent (newest first)", async () => {
  const r = new InMemoryEngagementRepository();
  await r.insertActivity({ kind: "win", username: "a", amountCents: 100, isSimulated: true, message: "m1" });
  await r.insertActivity({ kind: "signup", username: "b", amountCents: null, isSimulated: true, message: "m2" });
  const recent = await r.listRecentActivity(10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0]!.message, "m2"); // newest first
  assert.equal(recent[1]!.amountCents, 100);
});

test("InMemory engagement: chat insert, recent excludes hidden, hide is idempotent", async () => {
  const r = new InMemoryEngagementRepository();
  const c1 = await r.insertChat({ userId: "u1", username: "a", message: "hi" });
  const c2 = await r.insertChat({ userId: null, username: "sim", message: "yo" });
  assert.equal((await r.listRecentChat(10)).length, 2);
  assert.equal(await r.hideChat(c1.id), true);
  assert.equal(await r.hideChat(c1.id), false);   // already hidden
  assert.equal(await r.hideChat(99999), false);   // unknown id
  const visible = await r.listRecentChat(10);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]!.id, c2.id);
});

test("InMemory engagement: getUsername resolves registered handle", async () => {
  const r = new InMemoryEngagementRepository();
  assert.equal(await r.getUsername("u1"), null);
  r.setUsername("u1", "wanjiku_254");
  assert.equal(await r.getUsername("u1"), "wanjiku_254");
});

test("Pg engagement: maps inserts/queries to the right SQL + params", async () => {
  const calls: { text: string; params: unknown[] }[] = [];
  const fake: Querier = {
    async query(text, params) {
      calls.push({ text, params });
      if (text.startsWith("insert into activity_feed")) return { rows: [{ id: "7", created_at: new Date(1781778933000) }] };
      if (text.startsWith("insert into chat_messages")) return { rows: [{ id: "9", created_at: new Date(1781778933000) }] };
      if (text.startsWith("update chat_messages")) return { rows: [{ id: "9" }] };
      if (text.includes("from activity_feed")) return { rows: [{ id: "1", kind: "win", username: "a", amount: "12345", is_simulated: true, message: "m", created_at: new Date(1781778933000) }] };
      if (text.includes("from chat_messages")) return { rows: [{ id: "2", user_id: null, username: "sim", message: "yo", created_at: new Date(1781778933000) }] };
      if (text.includes("from profiles")) return { rows: [{ username: "njeri.ke" }] };
      return { rows: [] };
    },
  };
  const r = new PgEngagementRepository(fake);
  const a = await r.insertActivity({ kind: "win", username: "a", amountCents: 100, isSimulated: false, message: "m" });
  assert.equal(a.id, 7);
  assert.deepEqual(calls.at(-1)!.params, ["win", "a", 100, false, "m"]);
  const c = await r.insertChat({ userId: "u1", username: "a", message: "hi" });
  assert.equal(c.id, 9);
  assert.deepEqual(calls.at(-1)!.params, ["u1", "a", "hi"]);
  assert.equal(await r.hideChat(9), true);
  const act = await r.listRecentActivity(5);
  assert.equal(act[0]!.amountCents, 12345);
  const chat = await r.listRecentChat(5);
  assert.equal(chat[0]!.userId, null);
  assert.ok(calls.find((x) => x.text.includes("is_hidden = false") && x.text.includes("from chat_messages")), "recent chat must exclude hidden");
  assert.equal(await r.getUsername("u1"), "njeri.ke");
});

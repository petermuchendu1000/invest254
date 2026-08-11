import { test } from "node:test";
import assert from "node:assert/strict";
import { NotificationService, InMemoryNotificationRepository } from "./notifications.js";

function svc() {
  let t = 1_000;
  const repo = new InMemoryNotificationRepository(() => t++);
  return new NotificationService(repo, () => t);
}

test("create validates title and defaults level/dismissible", async () => {
  const s = svc();
  await assert.rejects(() => s.create({ userId: "u1", title: "   " }), /TITLE_REQUIRED/);
  await assert.rejects(() => s.create({ userId: "u1", title: "x".repeat(121) }), /TITLE_TOO_LONG/);
  const n = await s.create({ userId: "u1", title: "Bonus added" });
  assert.equal(n.level, "info");
  assert.equal(n.dismissible, true);
  assert.equal(n.resolvedAtMs, null);
});

test("listActive returns only non-dismissed, non-resolved, newest first", async () => {
  const s = svc();
  const a = await s.create({ userId: "u1", title: "first" });
  await s.create({ userId: "u1", title: "second" });
  await s.create({ userId: "u2", title: "other user" });
  let active = await s.listActive("u1");
  assert.deepEqual(active.map((r) => r.title), ["second", "first"]);
  await s.dismiss("u1", a.id);
  active = await s.listActive("u1");
  assert.deepEqual(active.map((r) => r.title), ["second"]);
});

test("a blocking notification cannot be dismissed by the player, only resolved by admin", async () => {
  const s = svc();
  const block = await s.create({ userId: "u1", title: "Account suspended", dismissible: false, category: "account_limited" });
  assert.equal(block.dismissible, false);
  assert.equal(await s.dismiss("u1", block.id), false, "player must not dismiss a blocking notice");
  assert.equal((await s.listActive("u1")).length, 1, "blocking notice stays active");
  assert.equal(await s.resolve(block.id), true);
  assert.equal((await s.listActive("u1")).length, 0, "resolved notice disappears");
  assert.equal(await s.resolve(block.id), false, "already resolved");
});

test("dismiss is scoped to the owner and only affects active dismissible rows", async () => {
  const s = svc();
  const n = await s.create({ userId: "u1", title: "hi" });
  assert.equal(await s.dismiss("u2", n.id), false, "another user cannot dismiss it");
  assert.equal(await s.dismiss("u1", n.id), true);
  assert.equal(await s.dismiss("u1", n.id), false, "already dismissed");
});

test("resolveByCategory clears every active row in a category for a user", async () => {
  const s = svc();
  await s.create({ userId: "u1", title: "Suspended a", dismissible: false, category: "account_limited" });
  await s.create({ userId: "u1", title: "Suspended b", dismissible: false, category: "account_limited" });
  await s.create({ userId: "u1", title: "keep me", category: "bonus" });
  const cleared = await s.resolveByCategory("u1", "account_limited");
  assert.equal(cleared, 2);
  const active = await s.listActive("u1");
  assert.deepEqual(active.map((r) => r.title), ["keep me"]);
});

test("adminList includes inactive rows when asked", async () => {
  const s = svc();
  const a = await s.create({ userId: "u1", title: "one" });
  await s.dismiss("u1", a.id);
  await s.create({ userId: "u1", title: "two" });
  assert.equal((await s.adminList("u1", true)).length, 2);
  assert.equal((await s.adminList("u1", false)).length, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryIdentityRepository } from "./identity.js";
import { AffiliateService } from "./affiliateservice.js";
import { AuthService } from "./authservice.js";
import { StubDarajaClient } from "./daraja.js";
import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from "@invest254/shared";

const HASH = "scrypt$32768$8$1$abcdefghijklmnop$abcdefghijklmnop"; // length >= 20 (repo gate)
const JWT = { jwtSecret: "test-secret-which-is-long-enough-123456", jwtTtlSeconds: 3600 };

test("AffiliateService.enroll: mints a canonical code, promotes player -> marketer, idempotent", async () => {
  const repo = new InMemoryIdentityRepository();
  const svc = new AffiliateService(repo);
  const { userId } = await repo.register("254700000001", "marketer1", HASH);

  const first = await svc.enroll(userId);
  assert.equal(first.referralCode.length, REFERRAL_CODE_LENGTH);
  for (const ch of first.referralCode) assert.ok(REFERRAL_CODE_ALPHABET.includes(ch), `bad char ${ch}`);
  assert.equal(first.commissionRate, 0.2);
  assert.equal(first.status, "active");
  assert.equal(first.role, "marketer");
  assert.equal(first.referralPath, `/r/${first.referralCode}`);

  const second = await svc.enroll(userId);
  assert.equal(second.referralCode, first.referralCode); // stable + idempotent
  assert.equal(second.role, "marketer");
});

test("AffiliateService.enroll: throws USER_NOT_FOUND for an unknown user", async () => {
  const svc = new AffiliateService(new InMemoryIdentityRepository());
  await assert.rejects(svc.enroll("00000000-0000-0000-0000-000000000000"), /USER_NOT_FOUND/);
});

test("register attribution: first-touch via a valid code (case-insensitive); unknown/absent ignored", async () => {
  const repo = new InMemoryIdentityRepository();
  const svc = new AffiliateService(repo);
  const aff = await repo.register("254700000002", "marketer2", HASH);
  const { referralCode } = await svc.enroll(aff.userId);

  const referred = await repo.register("254700000003", "player_a", HASH, referralCode.toLowerCase());
  assert.equal(repo.referredByOf(referred.userId), aff.userId);
  assert.equal(repo.referralCount(aff.userId), 1);

  const noCode = await repo.register("254700000004", "player_b", HASH);
  assert.equal(repo.referredByOf(noCode.userId), null);

  const unknown = await repo.register("254700000005", "player_c", HASH, "ZZZZ2222"); // well-formed, unknown
  assert.equal(repo.referredByOf(unknown.userId), null);
  assert.equal(repo.referralCount(aff.userId), 1); // unchanged
});

test("AuthService.register: rejects a malformed referral code, attributes a valid one", async () => {
  const repo = new InMemoryIdentityRepository();
  const auth = new AuthService(repo, JWT);
  const svc = new AffiliateService(repo);
  const aff = await auth.register({ phone: "0700000006", username: "marketer3", password: "Password1" });
  const { referralCode } = await svc.enroll(aff.userId);

  await assert.rejects(
    auth.register({ phone: "0700000007", username: "player_d", password: "Password1", referralCode: "bad" }),
    /INVALID_REFERRAL_CODE/,
  );
  const ok = await auth.register({ phone: "0700000008", username: "player_e", password: "Password1", referralCode });
  assert.equal(repo.referredByOf(ok.userId), aff.userId);
});

test("accrueDaily: 20% of zero-floored daily GGR; idempotent; rejects a malformed period", async () => {
  const repo = new InMemoryIdentityRepository();
  const svc = new AffiliateService(repo);
  const aff = await repo.register("254700000010", "mk_acc", HASH);
  const code = (await svc.enroll(aff.userId)).referralCode;
  const ref = await repo.register("254700000011", "pl_acc", HASH, code);

  // loss day: (10000-2500) + (5000-0) = 12500 GGR -> floor(12500*0.20) = 2500 commission
  repo.recordSettledPlay(ref.userId, "2026-06-10", 10000, 2500);
  repo.recordSettledPlay(ref.userId, "2026-06-10", 5000, 0);
  // winning day: (1000-5000) = -4000 -> floored to 0 -> no bucket
  repo.recordSettledPlay(ref.userId, "2026-06-11", 1000, 5000);

  assert.deepEqual(await svc.accrueDaily("2026-06-10"), { buckets: 1, totalCommissionCents: 2500 });
  assert.deepEqual(await svc.accrueDaily("2026-06-11"), { buckets: 0, totalCommissionCents: 0 });
  assert.deepEqual(await svc.accrueDaily("2026-06-10"), { buckets: 1, totalCommissionCents: 2500 }); // idempotent
  await assert.rejects(svc.accrueDaily("06/10/2026"), /INVALID_PERIOD/);
});

test("summary + dashboard reads: aggregates referrals, turnover, GGR, accrued/available", async () => {
  const repo = new InMemoryIdentityRepository();
  const svc = new AffiliateService(repo);
  const aff = await repo.register("254700000020", "mk_dash", HASH);
  const code = (await svc.enroll(aff.userId)).referralCode;
  const r1 = await repo.register("254700000021", "ref_x", HASH, code);
  const r2 = await repo.register("254700000022", "ref_y", HASH, code);
  repo.recordSettledPlay(r1.userId, "2026-06-10", 10000, 2500);
  repo.recordSettledPlay(r1.userId, "2026-06-10", 5000, 0);   // r1 GGR 12500 -> commission 2500
  repo.recordSettledPlay(r2.userId, "2026-06-10", 4000, 0);   // r2 GGR 4000  -> commission 800
  await svc.accrueDaily("2026-06-10");

  const s = await svc.summary(aff.userId);
  assert.equal(s.totalReferrals, 2);
  assert.equal(s.activePlayers7d, 2);
  assert.equal(s.turnoverCents, 19000);          // 10000 + 5000 + 4000
  assert.equal(s.ggrCents, 16500);               // 12500 + 4000
  assert.equal(s.commissionAccruedCents, 3300);  // 2500 + 800
  assert.equal(s.commissionPaidCents, 0);
  assert.equal(s.availableCents, 3300);
  assert.equal(s.commissionRate, 0.2);

  const refs = await svc.listReferrals(aff.userId, {});
  assert.equal(refs.items.length, 2);
  const ggrByName = Object.fromEntries(refs.items.map((i) => [i.username, i.lifetimeGgrCents]));
  assert.equal(ggrByName["ref_x"], 12500);
  assert.equal(ggrByName["ref_y"], 4000);

  const coms = await svc.listCommissions(aff.userId, {});
  assert.equal(coms.items.length, 2);
  assert.ok(coms.items.every((c) => c.period === "2026-06-10" && c.status === "accrued"));
});

test("summary: NOT_AFFILIATE when the caller is not enrolled", async () => {
  const repo = new InMemoryIdentityRepository();
  const svc = new AffiliateService(repo);
  const u = await repo.register("254700000023", "plain", HASH);
  await assert.rejects(svc.summary(u.userId), /NOT_AFFILIATE/);
});

// ───────────────────────────────────────── payouts (I4) ─────────────────────────────────────

/** Enroll a marketer with `cents` of accrued commission from one referred player on one day. */
async function withAccrued(phoneSuffix: string, cents: number) {
  const repo = new InMemoryIdentityRepository();
  const svc = new AffiliateService(repo, new StubDarajaClient());
  const aff = await repo.register(`2547010${phoneSuffix}`, `mk_${phoneSuffix}`, HASH);
  const code = (await svc.enroll(aff.userId)).referralCode;
  const ref = await repo.register(`2547020${phoneSuffix}`, `pl_${phoneSuffix}`, HASH, code);
  // GGR g with rate 0.2 yields floor(0.2g) commission; pick g so commission == cents exactly.
  repo.recordSettledPlay(ref.userId, "2026-06-10", cents * 5, 0);
  await svc.accrueDaily("2026-06-10");
  return { repo, svc, affId: aff.userId };
}

test("payout success: request reserves available, approve dispatches B2C, complete marks paid", async () => {
  const { svc, affId } = await withAccrued("31", 2500);

  const before = await svc.summary(affId);
  assert.equal(before.commissionAccruedCents, 2500);
  assert.equal(before.availableCents, 2500);

  const req = await svc.requestPayout(affId);
  assert.equal(req.amountCents, 2500);

  // reserved: still accrued, but no longer available
  const reserved = await svc.summary(affId);
  assert.equal(reserved.commissionAccruedCents, 2500);
  assert.equal(reserved.availableCents, 0);

  // a second request while one is in flight is refused
  await assert.rejects(svc.requestPayout(affId), /PAYOUT_PENDING/);

  const appr = await svc.approvePayout(req.payoutId, "admin-1");
  assert.equal(appr.approved, true);
  assert.ok(appr.conversationId, "B2C dispatched -> conversation id");

  // re-approve is a no-op (idempotent)
  assert.equal((await svc.approvePayout(req.payoutId, "admin-1")).approved, false);

  const comp = await svc.completePayout(req.payoutId, 0, "conv-1", "RCT1", "Success", {});
  assert.deepEqual(comp, { applied: true, status: "paid" });

  const after = await svc.summary(affId);
  assert.equal(after.commissionPaidCents, 2500);
  assert.equal(after.commissionAccruedCents, 0);
  assert.equal(after.availableCents, 0);

  // re-completing a terminal payout is a no-op
  assert.deepEqual(await svc.completePayout(req.payoutId, 0, "conv-1", "RCT1", "Success", {}), { applied: false, status: "paid" });
});

test("payout failure: B2C result code != 0 rejects the payout and restores availability", async () => {
  const { svc, affId } = await withAccrued("32", 1800);
  const req = await svc.requestPayout(affId);
  await svc.approvePayout(req.payoutId, "admin-1");

  const comp = await svc.completePayout(req.payoutId, 1, "conv-2", null, "Insufficient funds", {});
  assert.deepEqual(comp, { applied: true, status: "rejected" });

  const after = await svc.summary(affId);
  assert.equal(after.commissionPaidCents, 0);
  assert.equal(after.availableCents, 1800);  // reservation released

  // the affiliate can request again now that funds are back
  const req2 = await svc.requestPayout(affId);
  assert.equal(req2.amountCents, 1800);
});

test("payout reject: admin declines a pre-dispatch request and releases the reservation", async () => {
  const { svc, affId } = await withAccrued("33", 900);
  const req = await svc.requestPayout(affId);

  assert.equal(await svc.rejectPayout(req.payoutId, "admin-1"), true);
  assert.equal((await svc.summary(affId)).availableCents, 900);   // released

  assert.equal(await svc.rejectPayout(req.payoutId, "admin-1"), false);            // idempotent
  assert.equal((await svc.approvePayout(req.payoutId, "admin-1")).approved, false); // can't approve a rejected payout
});

test("payout: NO_AVAILABLE_COMMISSION when there is nothing to pay out", async () => {
  const repo = new InMemoryIdentityRepository();
  const svc = new AffiliateService(repo, new StubDarajaClient());
  const aff = await repo.register("254701000099", "mk_empty", HASH);
  await svc.enroll(aff.userId);
  await assert.rejects(svc.requestPayout(aff.userId), /NO_AVAILABLE_COMMISSION/);
});

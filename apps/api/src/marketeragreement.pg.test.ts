import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { makePgMarketerAgreement, PREFS_DEFAULT } from "./marketeragreement.pg.js";

/**
 * `makePgMarketerAgreement` against REAL SQL (migration 0214).
 *
 * The counting rule is the whole point of this feature and the only part of it that can be gamed, so
 * it is tested against the database rather than a double. A session costs nothing to create —
 * `end()` is `set ended_at = now()` with no duration check, and production already holds a ZERO
 * minute session — so if the floor does not bite, five taps are worth KES 1,500.
 *
 * E2E_PG_DSN only; everything is rolled back.
 */
const DSN = process.env.E2E_PG_DSN;

const SITE = "77770000-0000-0000-0000-000000000001";
const MK = "77770000-0000-0000-0000-000000000002";
const OTHER = "77770000-0000-0000-0000-000000000003";

/** A brand, two marketer profiles, and a clean slate. */
async function seed(c: pg.PoolClient): Promise<void> {
  await c.query(`insert into sites (id, slug, name, status) values ($1,'tgt','Target Brand','active')
                 on conflict (id) do nothing`, [SITE]);
  await c.query(`insert into profiles (id, phone, username, role, site_id) values
                   ($1,'254700009001','targetmk','marketer',$3),
                   ($2,'254700009002','othermk','marketer',$3)
                 on conflict (id) do nothing`, [MK, OTHER, SITE]);
}

/**
 * A session starting `atMins` from now (negative = in the past) and running `mins` minutes;
 * `mins = null` leaves it open.
 *
 * Every timestamp is computed in SQL from `now()`, which inside a transaction is the TRANSACTION
 * start — frozen for the whole test. That is what makes these fixtures deterministic, and it is also
 * the trap: a target created with the column default also lands on exactly `now()`, so a session
 * placed "in the past" would start BEFORE its own target and count for nothing. `backdate` moves the
 * target instead, which is the only way to put a session inside one without the clock moving.
 */
async function session(c: pg.PoolClient, marketer: string, atMins: number, mins: number | null): Promise<void> {
  await c.query(
    `insert into marketer_live_sessions (site_id, marketer_id, started_at, ends_at, ended_at, margin_minutes)
     values ($1, $2,
             now() + make_interval(mins => $3),
             now() + make_interval(mins => $3 + 60),
             case when $4::int is null then null else now() + make_interval(mins => $3 + $4::int) end,
             10)`,
    [SITE, marketer, atMins, mins],
  );
}

/** Move the marketer's open target back, so sessions can be placed inside its window. */
async function backdate(c: pg.PoolClient, marketer: string, mins: number): Promise<void> {
  await c.query(
    `update marketer_session_targets set started_at = now() - make_interval(mins => $3)
      where site_id = $1 and marketer_id = $2 and closed_at is null`,
    [SITE, marketer, mins],
  );
}

const store = (c: pg.PoolClient) =>
  makePgMarketerAgreement({ query: (sql: string, p?: unknown[]) => c.query(sql, p as unknown[]) } as never);

async function withDb(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const pool = new pg.Pool({ connectionString: DSN });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await seed(c);
    await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
    await pool.end();
  }
}

test("a target counts only sessions that are long enough — the gaming hole", { skip: !DSN }, async () => {
  await withDb(async (c) => {
    const s = store(c);
    await s.startTarget(SITE, MK, { targetSessions: 5, amountCents: 150000, qualifyMinutes: 30 }, MK);
    await backdate(c, MK, 240);

    // Five taps, the shape production already contains: a 0-minute session and a 3-minute one.
    await session(c, MK, -200, 0);
    await session(c, MK, -190, 3);
    await session(c, MK, -180, 1);
    await session(c, MK, -170, 0);
    await session(c, MK, -160, 29);   // one minute under the floor
    let got = await s.forMarketer(SITE, MK);
    assert.equal(got.target?.completed, 0, "five short sessions must be worth nothing");
    assert.equal(got.target?.done, false);

    // Exactly at the floor counts: the rule is >=, and an operator who sets 30 means 30.
    await session(c, MK, -150, 30);
    got = await s.forMarketer(SITE, MK);
    assert.equal(got.target?.completed, 1, "a session of exactly qualifyMinutes counts");

    await session(c, MK, -140, 31);
    await session(c, MK, -130, 90);
    got = await s.forMarketer(SITE, MK);
    assert.equal(got.target?.completed, 3);
    assert.equal(got.target?.done, false, "3 of 5 is not done");
  });
});

test("a session still running does not count, and never blocks the ones that do", { skip: !DSN }, async () => {
  await withDb(async (c) => {
    const s = store(c);
    await s.startTarget(SITE, MK, { targetSessions: 2, amountCents: 50000, qualifyMinutes: 30 }, MK);
    await backdate(c, MK, 240);
    await session(c, MK, -200, 60);       // finished, counts
    await session(c, MK, -100, null);     // open: long enough by the clock, but not finished
    const got = await s.forMarketer(SITE, MK);
    assert.equal(got.target?.completed, 1, "an open session is work not yet finished");
    assert.equal(got.target?.done, false);
  });
});

test("starting a new target resets progress and closes the old one", { skip: !DSN }, async () => {
  await withDb(async (c) => {
    const s = store(c);
    await s.startTarget(SITE, MK, { targetSessions: 2, amountCents: 50000, qualifyMinutes: 30 }, MK);
    await backdate(c, MK, 240);
    await session(c, MK, -200, 60);
    await session(c, MK, -180, 60);
    assert.equal((await s.forMarketer(SITE, MK)).target?.done, true, "2/2 before the reset");

    await s.startTarget(SITE, MK, { targetSessions: 5, amountCents: 150000, qualifyMinutes: 30 }, MK);
    const after = await s.forMarketer(SITE, MK);
    assert.equal(after.target?.completed, 0, "the new target starts at zero: earlier sessions belong to the closed one");
    assert.equal(after.target?.targetSessions, 5);

    // uq_session_target_open: exactly one open row, whatever the history.
    const open = await c.query(
      `select count(*)::int as n from marketer_session_targets where site_id=$1 and marketer_id=$2 and closed_at is null`,
      [SITE, MK]);
    assert.equal(open.rows[0]!.n, 1, "never two open targets");
    const all = await c.query(
      `select count(*)::int as n from marketer_session_targets where site_id=$1 and marketer_id=$2`, [SITE, MK]);
    assert.equal(all.rows[0]!.n, 2, "the old target is closed, not deleted — it is the record of what was agreed");
  });
});

test("a session that STARTED before the target does not count toward it", { skip: !DSN }, async () => {
  /**
   * The boundary that decides who owns a session spanning two targets. Keying on `ended_at` would
   * hand it to the incoming agreement, crediting a new target with work done under the old one.
   */
  await withDb(async (c) => {
    const s = store(c);
    await session(c, MK, -300, 55);                // ran, and finished, before the target opened
    await s.startTarget(SITE, MK, { targetSessions: 1, amountCents: 50000, qualifyMinutes: 30 }, MK);
    await backdate(c, MK, 240);
    assert.equal((await s.forMarketer(SITE, MK)).target?.completed, 0,
      "work done before the agreement is not counted against it");

    // THE SPANNING SESSION — the case the rule is actually choosing between. This one starts 20
    // minutes BEFORE the target opens and ends 20 minutes AFTER it. Keyed on `started_at` it belongs
    // to the previous agreement and does not count here; keyed on `ended_at` the new target would be
    // credited with work done under the old one. Without this case both rules look identical.
    await session(c, MK, -260, 40);
    assert.equal((await s.forMarketer(SITE, MK)).target?.completed, 0,
      "a session that began before the target belongs to the agreement it began under");

    await session(c, MK, -100, 40);
    assert.equal((await s.forMarketer(SITE, MK)).target?.completed, 1);
  });
});

test("one marketer's sessions never count toward another's target", { skip: !DSN }, async () => {
  await withDb(async (c) => {
    const s = store(c);
    await s.startTarget(SITE, MK, { targetSessions: 3, amountCents: 90000, qualifyMinutes: 30 }, MK);
    await backdate(c, MK, 240);
    await session(c, OTHER, -200, 60);
    await session(c, OTHER, -180, 60);
    assert.equal((await s.forMarketer(SITE, MK)).target?.completed, 0);
    assert.equal((await s.forMarketer(SITE, OTHER)).target, null, "no target, no progress to report");
  });
});

test("an unconfigured marketer sees everything, and configuring one never touches another", { skip: !DSN }, async () => {
  await withDb(async (c) => {
    const s = store(c);
    // THE INVARIANT that protects the 28 marketers who exist today: no row = every block visible.
    assert.deepEqual((await s.forMarketer(SITE, MK)).prefs, PREFS_DEFAULT);

    await s.savePrefs(SITE, MK, { showEarnings: false }, MK);
    const mine = await s.forMarketer(SITE, MK);
    assert.equal(mine.prefs.showEarnings, false, "the one switch set");
    assert.equal(mine.prefs.showLive, true, "a partial patch leaves the rest alone");
    assert.deepEqual((await s.forMarketer(SITE, OTHER)).prefs, PREFS_DEFAULT, "the other marketer is untouched");

    await s.savePrefs(SITE, MK, { showEarnings: true }, MK);
    assert.deepEqual((await s.forMarketer(SITE, MK)).prefs, PREFS_DEFAULT, "and it goes back");
  });
});

test("the admin listing shows every marketer, with or without terms", { skip: !DSN }, async () => {
  await withDb(async (c) => {
    const s = store(c);
    await s.startTarget(SITE, MK, { targetSessions: 4, amountCents: 120000, qualifyMinutes: 30 }, MK);
    await backdate(c, MK, 240);
    await session(c, MK, -200, 45);
    await s.savePrefs(SITE, OTHER, { showEarnings: false, showAdvance: false }, OTHER);

    const rows = await s.listMarketers(SITE);
    assert.equal(rows.length, 2, "both marketer profiles on the brand");
    const a = rows.find((r) => r.marketerId === MK)!;
    const b = rows.find((r) => r.marketerId === OTHER)!;
    assert.equal(a.target?.completed, 1, "the listing computes progress the same way the marketer sees it");
    assert.equal(a.target?.targetSessions, 4);
    assert.deepEqual(a.prefs, PREFS_DEFAULT, "an outer join with no prefs row must read as all-visible, not all-hidden");
    assert.equal(b.target, null, "no target is null, not a zeroed one");
    assert.equal(b.prefs.showEarnings, false);
    assert.equal(b.prefs.showLive, true);
    assert.equal(a.username, "targetmk");
  });
});

test("closing a target leaves the marketer with none, and closing twice is refused by the caller", { skip: !DSN }, async () => {
  await withDb(async (c) => {
    const s = store(c);
    await s.startTarget(SITE, MK, { targetSessions: 2, amountCents: 50000, qualifyMinutes: 30 }, MK);
    assert.ok(await s.closeTarget(SITE, MK));
    assert.equal((await s.forMarketer(SITE, MK)).target, null);
    assert.equal(await s.closeTarget(SITE, MK), null, "nothing open to close — the route turns this into a 409");
  });
});

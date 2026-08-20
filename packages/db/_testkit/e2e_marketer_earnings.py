#!/usr/bin/env python3
"""Aggressive e2e for fn_platform_marketer_earnings (Task 4 — platform earnings console).

Resets a local Postgres, applies the shim + ALL migrations, then exercises the comprehensive
per-(marketer, site) earnings RPC:
  GATE      rejects any non-platform role.
  IDENTITY  surfaces marketer username/phone + affiliate status + commission rate + site.
  CLIENTS   total vs active client counts (active = referred profile status='active').
  DEPOSITS  sums only SUCCESSFUL deposits by the marketer's referred clients, same site.
  MONEY     accrued commission, paid vs pending payouts, expenses, and balance_due math.
  SCOPING   commissions/payouts/expenses on a DIFFERENT site never leak into this site's row.

Run: PGCLIENTENCODING=UTF8 python3 packages/db/_testkit/e2e_marketer_earnings.py   (needs local PG on /tmp:5433)
"""
import os, sys, glob, uuid
import psycopg2

DSN  = dict(host="/tmp", port=5433, user="postgres", dbname="invest254_test")
BASE = os.path.join(os.path.dirname(__file__), "..")
SHIM = os.path.join(os.path.dirname(__file__), "00_supabase_shim.sql")
SITE_A = "00000000-0000-0000-0000-000000000001"
ACTOR  = str(uuid.uuid4())
PS = "platform_superadmin"

PASS, FAIL = [], []
def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))

def q1(cur, sql, args=None):
    cur.execute(sql, args or []); return cur.fetchone()

def expect_error(cur, sql, args, code_substr, name):
    try:
        cur.execute(sql, args); cur.connection.rollback(); check(name, False, "no error raised")
    except Exception as e:
        cur.connection.rollback(); check(name, code_substr.lower() in str(e).lower(), f"got: {str(e).strip()[:90]}")

def reset_and_migrate():
    admin = psycopg2.connect(host="/tmp", port=5433, user="postgres", dbname="postgres"); admin.autocommit = True
    with admin.cursor() as c:
        c.execute("select pg_terminate_backend(pid) from pg_stat_activity where datname='invest254_test' and pid<>pg_backend_pid()")
        c.execute("drop database if exists invest254_test"); c.execute("create database invest254_test")
    admin.close()
    conn = psycopg2.connect(**DSN); conn.set_client_encoding("UTF8"); conn.autocommit = True
    with conn.cursor() as c:
        c.execute(open(SHIM, encoding="utf-8").read())
        for f in sorted(glob.glob(os.path.join(BASE, "migrations", "00*.sql"))):
            c.execute(open(f, encoding="utf-8").read())
    return conn

_phone = [254700000000]
def reg(cur, uname, site):
    _phone[0] += 1
    return q1(cur, "select user_id from fn_register_user(%s,%s,%s,null,%s)", [str(_phone[0]), uname, "h"+"x"*24, site])[0]

def enroll(cur, uid, code, site, rate=0.20):
    cur.execute("insert into affiliates(user_id, referral_code, site_id, commission_rate) values (%s,%s,%s,%s)", [uid, code, site, rate])

def refer(cur, aff, ref, site):
    cur.execute("insert into referrals(affiliate_id, referred_user, site_id) values (%s,%s,%s)", [aff, ref, site])

def commission(cur, aff, ref, period, ggr, comm, site):
    cur.execute("insert into affiliate_commissions(affiliate_id, referred_user, period, ggr, commission, status, site_id) values (%s,%s,%s,%s,%s,'accrued',%s)",
                [aff, ref, period, ggr, comm, site])

def deposit(cur, uid, amount, status, site):
    cur.execute("insert into transactions(user_id, kind, amount, status, phone, site_id) values (%s,'deposit',%s,%s,'254700111222',%s)", [uid, amount, status, site])

def payout(cur, beneficiary, amount, status, site):
    cur.execute("insert into commission_payouts(beneficiary_user, site_id, amount_cents, status) values (%s,%s,%s,%s)", [beneficiary, site, amount, status])

def expense(cur, marketer, amount, site, cat="tiktok_promo"):
    cur.execute("insert into marketer_expenses(site_id, marketer_user_id, category, amount_cents) values (%s,%s,%s,%s)", [site, marketer, cat, amount])

def main():
    cur = reset_and_migrate().cursor()

    print("\n== GATE: earnings RPC rejects non-platform roles ==")
    for role in ("admin", "superadmin", "marketer", "player"):
        expect_error(cur, "select * from fn_platform_marketer_earnings(%s)", [role], "NOT_AUTHORIZED", f"earnings rejected for {role}")

    print("\n== SETUP: two brands; a rich marketer on A + a marketer on B ==")
    site_b = q1(cur, "select fn_platform_create_site(%s,%s,'brandb','Brand B','KES','brandb.example')", [ACTOR, PS])[0]

    # Marketer on brand A: rate 0.25, 3 clients, one flipped suspended, deposits (one failed), commissions,
    # a paid + a pending payout, one expense, PLUS a stray commission on brand B that must NOT leak.
    jane = reg(cur, "jane", SITE_A)
    enroll(cur, jane, "code_jane", SITE_A, rate=0.25)
    clients = []
    for i in range(3):
        c = reg(cur, f"jane_c{i}", SITE_A); clients.append(c)
        refer(cur, jane, c, SITE_A)
        commission(cur, jane, c, "2026-05-01", 10000, 2000, SITE_A)   # comm 2000 each -> 6000 total
        deposit(cur, c, 5000, "success", SITE_A)                      # 5000 each -> 15000
    deposit(cur, clients[0], 9999, "failed", SITE_A)                  # must be ignored
    cur.execute("update profiles set status='suspended' where id=%s", [clients[2]])  # active_clients -> 2
    payout(cur, jane, 1500, "paid", SITE_A)
    payout(cur, jane, 500, "requested", SITE_A)                       # pending
    payout(cur, jane, 300, "rejected", SITE_A)                        # neither paid nor pending
    expense(cur, jane, 800, SITE_A)
    # Cross-site contamination attempt: a commission + payout + expense for jane on brand B.
    commission(cur, jane, clients[0], "2026-05-01", 99999, 99999, site_b)
    payout(cur, jane, 99999, "paid", site_b)
    expense(cur, jane, 99999, site_b)

    # A second marketer on brand B (isolation control).
    bob = reg(cur, "bob", site_b)
    enroll(cur, bob, "code_bob", site_b, rate=0.30)
    for i in range(2):
        c = reg(cur, f"bob_c{i}", site_b); refer(cur, bob, c, site_b)
        commission(cur, bob, c, "2026-06-01", 4000, 1200, site_b)

    print("\n== EARNINGS: comprehensive per-(marketer, site) row ==")
    cur.execute("""select affiliate_user_id, username, phone, site_id, site_name, affiliate_status,
                          commission_rate, total_clients, active_clients, deposits_cents, ggr_cents,
                          commission_cents, paid_cents, pending_cents, expenses_cents, balance_due_cents,
                          last_commission_period
                     from fn_platform_marketer_earnings(%s)""", [PS])
    rows = {str(r[0]): r for r in cur.fetchall()}
    j = rows.get(str(jane)); b = rows.get(str(bob))

    check("jane row present with identity", j is not None and j[1] == "jane" and j[4] == "Invest254", f"{j}")
    check("jane commission_rate = 0.25", j is not None and float(j[6]) == 0.25, f"rate={j[6] if j else None}")
    check("jane total_clients = 3", j is not None and j[7] == 3, f"total={j[7] if j else None}")
    check("jane active_clients = 2 (one suspended)", j is not None and j[8] == 2, f"active={j[8] if j else None}")
    check("jane deposits = 15000 (failed ignored)", j is not None and j[9] == 15000, f"dep={j[9] if j else None}")
    check("jane ggr = 30000 (site-scoped, B excluded)", j is not None and j[10] == 30000, f"ggr={j[10] if j else None}")
    check("jane commission = 6000 (site-scoped, B excluded)", j is not None and j[11] == 6000, f"comm={j[11] if j else None}")
    check("jane paid = 1500 (site-scoped)", j is not None and j[12] == 1500, f"paid={j[12] if j else None}")
    check("jane pending = 500 (requested/approved only)", j is not None and j[13] == 500, f"pending={j[13] if j else None}")
    check("jane expenses = 800 (site-scoped)", j is not None and j[14] == 800, f"exp={j[14] if j else None}")
    # balance_due = 6000 - 1500 - 500 - 800 = 3200
    check("jane balance_due = 3200", j is not None and j[15] == 3200, f"bal={j[15] if j else None}")

    check("bob isolated on brand B", b is not None and b[4] == "Brand B" and b[7] == 2 and b[11] == 2400, f"{b}")
    check("bob rate = 0.30", b is not None and float(b[6]) == 0.30, f"rate={b[6] if b else None}")

    print(f"\n==== RESULT: {len(PASS)} passed, {len(FAIL)} failed ====")
    if FAIL:
        print("FAILED:", ", ".join(FAIL)); sys.exit(1)
    print("ALL MARKETER-EARNINGS DB E2E SCENARIOS PASSED")

if __name__ == "__main__":
    main()

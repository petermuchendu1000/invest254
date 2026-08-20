#!/usr/bin/env python3
"""Aggressive e2e for the 200 KES welcome bonus (Task 2), granted inside fn_register_user (0095).

Resets a local Postgres, applies the shim + ALL migrations, then verifies:
  CREDIT    a new signup's wallet real_balance is exactly 20,000 cents (200 KES).
  BONUS     a 'welcome' bonus row is written: cleared, amount 20,000, no wagering, right site.
  LEDGER    a matching ledger entry (type='bonus', balance_kind='real', ref -> the bonus) exists.
  ONCE      each registration credits exactly one bonus (no duplicates).
  PER-SITE  the bonus is scoped to the brand the user registered on (multi-brand safe).
  REPORTING the credit is NOT counted as a deposit (transactions has no deposit row).

Run: PGCLIENTENCODING=UTF8 python3 packages/db/_testkit/e2e_welcome_bonus.py   (needs local PG on /tmp:5433)
"""
import os, sys, glob, uuid
import psycopg2

DSN  = dict(host="/tmp", port=5433, user="postgres", dbname="invest254_test")
BASE = os.path.join(os.path.dirname(__file__), "..")
SHIM = os.path.join(os.path.dirname(__file__), "00_supabase_shim.sql")
SITE_A = "00000000-0000-0000-0000-000000000001"
ACTOR  = str(uuid.uuid4())
PS = "platform_superadmin"
WELCOME = 20000

PASS, FAIL = [], []
def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))

def q1(cur, sql, args=None):
    cur.execute(sql, args or []); return cur.fetchone()

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

def main():
    cur = reset_and_migrate().cursor()

    print("\n== CREDIT + BONUS + LEDGER for a new signup ==")
    uid = reg(cur, "amina", SITE_A)
    bal = q1(cur, "select real_balance from wallets where user_id=%s and site_id=%s", [uid, SITE_A])[0]
    check("wallet real_balance = 20000 (200 KES)", bal == WELCOME, f"bal={bal}")

    brow = q1(cur, "select type, amount, wagering_x, wagered, status, site_id from bonuses where user_id=%s", [uid])
    check("welcome bonus row present", brow is not None, f"{brow}")
    check("bonus type='welcome', amount=20000, cleared, no wagering, right site",
          brow is not None and brow[0]=='welcome' and brow[1]==WELCOME and float(brow[2])==0 and brow[3]==0
          and brow[4]=='cleared' and str(brow[5])==SITE_A, f"{brow}")

    lrow = q1(cur, "select type, amount, balance_kind, ref_table, ref_id, site_id from ledger_entries where user_id=%s and type='bonus'", [uid])
    bonus_id = q1(cur, "select id from bonuses where user_id=%s", [uid])[0]
    check("ledger entry: bonus / real / references the bonus row",
          lrow is not None and lrow[0]=='bonus' and lrow[1]==WELCOME and lrow[2]=='real'
          and lrow[3]=='bonuses' and lrow[4]==str(bonus_id) and str(lrow[5])==SITE_A, f"{lrow}")

    n_bonus = q1(cur, "select count(*) from bonuses where user_id=%s", [uid])[0]
    n_ledger = q1(cur, "select count(*) from ledger_entries where user_id=%s and type='bonus'", [uid])[0]
    check("exactly one bonus row", n_bonus == 1, f"n={n_bonus}")
    check("exactly one bonus ledger entry", n_ledger == 1, f"n={n_ledger}")

    print("\n== REPORTING: credit is NOT a deposit ==")
    n_dep = q1(cur, "select count(*) from transactions where user_id=%s and kind='deposit'", [uid])[0]
    check("no deposit transaction created by the bonus", n_dep == 0, f"n={n_dep}")

    print("\n== PER-SITE: bonus scoped to the brand registered on ==")
    site_b = q1(cur, "select fn_platform_create_site(%s,%s,'brandb','Brand B','KES','brandb.example')", [ACTOR, PS])[0]
    uid_b = reg(cur, "amina", site_b)   # same username allowed on a different brand
    bal_b = q1(cur, "select real_balance from wallets where user_id=%s and site_id=%s", [uid_b, site_b])[0]
    b_site = q1(cur, "select site_id from bonuses where user_id=%s", [uid_b])[0]
    check("brand-B signup also gets 20000 on brand B", bal_b == WELCOME, f"bal={bal_b}")
    check("brand-B bonus is scoped to brand B", str(b_site) == str(site_b), f"site={b_site}")
    # brand A user's wallet on brand B does not exist / is untouched
    other = q1(cur, "select count(*) from wallets where user_id=%s and site_id=%s", [uid, site_b])[0]
    check("brand-A user has no wallet on brand B", other == 0, f"n={other}")

    print(f"\n==== RESULT: {len(PASS)} passed, {len(FAIL)} failed ====")
    if FAIL:
        print("FAILED:", ", ".join(FAIL)); sys.exit(1)
    print("ALL WELCOME-BONUS DB E2E SCENARIOS PASSED")

if __name__ == "__main__":
    main()

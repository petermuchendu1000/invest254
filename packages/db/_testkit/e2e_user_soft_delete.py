#!/usr/bin/env python3
"""Aggressive e2e for Task 1 DB layer: recoverable soft-delete (0096) + marketer set-site (0097).

Resets a local Postgres, applies the shim + ALL migrations, then verifies:
  DELETE   role-gated; NO_SELF_ACTION; SUPERADMIN_PROTECTED; admin cannot delete admin; a player
           delete flips status->banned, stamps deleted_at + prior status, and is idempotent + audited.
  RESTORE  reverts to the prior status, clears the delete columns, is idempotent, and is audited.
  MOVE     a marketer moves brands; SITE_NOT_FOUND / MARKETER_NOT_FOUND rejected; destination
           phone-uniqueness enforced (PHONE_TAKEN); same-site is a no-op.

Run: PGCLIENTENCODING=UTF8 python3 packages/db/_testkit/e2e_user_soft_delete.py   (needs local PG on /tmp:5433)
"""
import os, sys, glob, uuid
import psycopg2

DSN  = dict(host="/tmp", port=5433, user="postgres", dbname="invest254_test")
BASE = os.path.join(os.path.dirname(__file__), "..")
SHIM = os.path.join(os.path.dirname(__file__), "00_supabase_shim.sql")
SITE_A = "00000000-0000-0000-0000-000000000001"
PS = "platform_superadmin"
ACTOR = str(uuid.uuid4())

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
def reg(cur, uname, site=SITE_A):
    _phone[0] += 1
    return q1(cur, "select user_id from fn_register_user(%s,%s,%s,null,%s)", [str(_phone[0]), uname, "h"+"x"*24, site])[0]

def set_role(cur, uid, role):
    cur.execute("update profiles set role=%s where id=%s", [role, uid])

def main():
    cur = reset_and_migrate().cursor()

    print("\n== SOFT-DELETE: gating ==")
    victim = reg(cur, "victim")
    for role in ("player", "marketer"):
        expect_error(cur, "select * from fn_admin_delete_user(%s,%s,%s,%s)", [ACTOR, role, victim, "x"], "NOT_AUTHORIZED", f"delete rejected for {role}")
    expect_error(cur, "select * from fn_admin_delete_user(%s,%s,%s,%s)", [victim, "admin", victim, "x"], "NO_SELF_ACTION", "delete self rejected")
    sa = reg(cur, "superadmin1"); set_role(cur, sa, "superadmin")
    expect_error(cur, "select * from fn_admin_delete_user(%s,%s,%s,%s)", [ACTOR, "admin", sa, "x"], "SUPERADMIN_PROTECTED", "deleting a superadmin rejected")
    adm = reg(cur, "adminx"); set_role(cur, adm, "admin")
    expect_error(cur, "select * from fn_admin_delete_user(%s,%s,%s,%s)", [ACTOR, "admin", adm, "x"], "INSUFFICIENT_PRIVILEGE", "admin cannot delete admin")

    print("\n== SOFT-DELETE: delete a player ==")
    # give the victim a non-default prior status to prove it's preserved on restore.
    cur.execute("update profiles set status='suspended' where id=%s", [victim])
    row = q1(cur, "select * from fn_admin_delete_user(%s,%s,%s,%s)", [ACTOR, "admin", victim, "fraud"])
    p = q1(cur, "select status, deleted_at, deleted_by, delete_reason, status_before_delete from profiles where id=%s", [victim])
    check("status flipped to banned (money lockout)", p[0] == "banned", f"status={p[0]}")
    check("deleted_at stamped", p[1] is not None)
    check("deleted_by = actor", str(p[2]) == ACTOR, f"by={p[2]}")
    check("delete_reason saved", p[3] == "fraud", f"reason={p[3]}")
    check("prior status saved (suspended)", p[4] == "suspended", f"prev={p[4]}")
    n_del = q1(cur, "select count(*) from admin_actions where action='user.delete' and target_id=%s", [victim])[0]
    check("delete audited", n_del == 1, f"n={n_del}")

    print("\n== SOFT-DELETE: idempotent delete ==")
    first_at = p[1]
    q1(cur, "select * from fn_admin_delete_user(%s,%s,%s,%s)", [ACTOR, "admin", victim, "again"])
    again = q1(cur, "select deleted_at from profiles where id=%s", [victim])[0]
    check("second delete is a no-op (deleted_at unchanged)", again == first_at, f"{again} vs {first_at}")
    n_del2 = q1(cur, "select count(*) from admin_actions where action='user.delete' and target_id=%s", [victim])[0]
    check("no duplicate delete audit", n_del2 == 1, f"n={n_del2}")

    print("\n== RESTORE ==")
    q1(cur, "select * from fn_admin_restore_user(%s,%s,%s)", [ACTOR, "admin", victim])
    r = q1(cur, "select status, deleted_at, deleted_by, delete_reason, status_before_delete from profiles where id=%s", [victim])
    check("status reverted to prior (suspended)", r[0] == "suspended", f"status={r[0]}")
    check("deleted_at cleared", r[1] is None)
    check("delete columns cleared", r[2] is None and r[3] is None and r[4] is None)
    n_res = q1(cur, "select count(*) from admin_actions where action='user.restore' and target_id=%s", [victim])[0]
    check("restore audited", n_res == 1, f"n={n_res}")
    # idempotent restore
    q1(cur, "select * from fn_admin_restore_user(%s,%s,%s)", [ACTOR, "admin", victim])
    n_res2 = q1(cur, "select count(*) from admin_actions where action='user.restore' and target_id=%s", [victim])[0]
    check("restore of a non-deleted user is a no-op", n_res2 == 1, f"n={n_res2}")

    print("\n== MARKETER MOVE ==")
    site_b = q1(cur, "select fn_platform_create_site(%s,%s,'brandb','Brand B','KES','brandb.example')", [ACTOR, PS])[0]
    mk = q1(cur, "select id from fn_marketer_create(%s,%s,%s)", ["Peter", "0733000001", SITE_A])[0]
    expect_error(cur, "select fn_marketer_set_site(%s,%s)", [str(uuid.uuid4()), site_b], "MARKETER_NOT_FOUND", "move of unknown marketer rejected")
    expect_error(cur, "select fn_marketer_set_site(%s,%s)", [mk, str(uuid.uuid4())], "SITE_NOT_FOUND", "move to unknown site rejected")
    # same-site no-op
    q1(cur, "select fn_marketer_set_site(%s,%s)", [mk, SITE_A])
    check("same-site move keeps site A", str(q1(cur, "select site_id from marketers where id=%s", [mk])[0]) == SITE_A)
    # real move A -> B
    q1(cur, "select fn_marketer_set_site(%s,%s)", [mk, site_b])
    check("marketer moved to brand B", str(q1(cur, "select site_id from marketers where id=%s", [mk])[0]) == str(site_b))
    # PHONE_TAKEN: another marketer with same phone already on the destination
    mk_a2 = q1(cur, "select id from fn_marketer_create(%s,%s,%s)", ["Dupe", "0733000009", SITE_A])[0]
    q1(cur, "select id from fn_marketer_create(%s,%s,%s)", ["Existing", "0733000009", site_b])
    expect_error(cur, "select fn_marketer_set_site(%s,%s)", [mk_a2, site_b], "PHONE_TAKEN", "move blocked when phone taken on destination")

    print(f"\n==== RESULT: {len(PASS)} passed, {len(FAIL)} failed ====")
    if FAIL:
        print("FAILED:", ", ".join(FAIL)); sys.exit(1)
    print("ALL USER-SOFT-DELETE + MARKETER-MOVE DB E2E SCENARIOS PASSED")

if __name__ == "__main__":
    main()

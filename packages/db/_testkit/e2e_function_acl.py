#!/usr/bin/env python3
"""Function-ACL invariant e2e (migration 0151) -- docs/39 finding 01.

Reproduces the PRODUCTION exposure and proves it stays closed.

Supabase grants EXECUTE on every function created in `public` to `anon` and `authenticated` by
DEFAULT PRIVILEGE, so a SECURITY DEFINER routine -- which runs as the table owner and therefore
bypasses RLS -- becomes callable with the PUBLIC browser anon key. This harness emulates that
posture, then asserts the invariant migration 0151 establishes:

  1. ZERO SECURITY DEFINER functions in `public` are EXECUTE-able by anon or authenticated.
  2. Every SECURITY DEFINER function stays EXECUTE-able by the owner (the API connects as the
     owner), so the fix cannot break the application.
  3. A function created AFTER 0151 is auto-locked by the lock_definer_execute event trigger.
  4. Plain (invoker) functions stay EXECUTE-able by authenticated, or RLS policies that call them
     (is_site_admin/current_site/current_platform) can no longer be evaluated.
  5. Every function referenced by an RLS policy in `public` is still callable by authenticated.

Run: python3 packages/db/_testkit/e2e_function_acl.py   (needs local PG on /tmp:5433)
"""
import os, sys, glob
import psycopg2

DSN  = dict(host="/tmp", port=5433, user="postgres", dbname="invest254_test")
BASE = os.path.join(os.path.dirname(__file__), "..")
SHIM = os.path.join(os.path.dirname(__file__), "00_supabase_shim.sql")

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))


def q1(cur, sql, args=None):
    cur.execute(sql, args or [])
    row = cur.fetchone()
    return row[0] if row else None


def reset_and_migrate(migration_upper_bound=None):
    """Fresh DB: Supabase shim + Supabase DEFAULT PRIVILEGES + migrations in filename order."""
    admin = psycopg2.connect(host="/tmp", port=5433, user="postgres", dbname="postgres")
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute("select pg_terminate_backend(pid) from pg_stat_activity "
                  "where datname='invest254_test' and pid<>pg_backend_pid()")
        c.execute("drop database if exists invest254_test")
        c.execute("create database invest254_test")
    admin.close()
    conn = psycopg2.connect(**DSN)
    conn.set_client_encoding("UTF8")
    conn.autocommit = True
    with conn.cursor() as c:
        c.execute(open(SHIM, encoding="utf-8").read())
        # Emulate Supabase's posture for functions (pg_default_acl, defaclobjtype 'f'). Without this
        # the harness cannot see the production bug at all.
        c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated")
        for f in sorted(glob.glob(os.path.join(BASE, "migrations", "[0-9][0-9][0-9][0-9]_*.sql"))):
            if migration_upper_bound and os.path.basename(f) > migration_upper_bound:
                continue
            c.execute(open(f, encoding="utf-8").read())
    return conn


def definer_exposed(cur):
    cur.execute("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname='public' and p.prokind='f' and p.prosecdef
                     and (has_function_privilege('anon', p.oid, 'EXECUTE')
                          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))""")
    return cur.fetchone()[0]


def main():
    print("\n== 0. REPRODUCE the production exposure (migrations up to 0150, Supabase posture) ==")
    conn = reset_and_migrate(migration_upper_bound="0150")
    cur = conn.cursor()
    exposed = definer_exposed(cur)
    check("pre-0151: SECURITY DEFINER functions ARE anon/authenticated-executable (bug reproduced)",
          exposed > 0, f"exposed={exposed}")
    print(f"       {exposed} SECURITY DEFINER routines reachable with the public anon key")
    cur.execute("""select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname='public' and p.prosecdef
                     and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1 limit 12""")
    print("       e.g. " + ", ".join(r[0] for r in cur.fetchall()))
    conn.close()

    print("\n== 1. AFTER 0151: the invariant holds ==")
    conn = reset_and_migrate()
    cur = conn.cursor()

    still = definer_exposed(cur)
    check("post-0151: ZERO SECURITY DEFINER functions anon/authenticated-executable", still == 0,
          f"still exposed={still}")
    print(f"       SECURITY DEFINER functions in public: "
          f"{q1(cur, 'select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=%s and p.prosecdef', ['public'])}")

    not_callable = q1(cur, """select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname='public' and p.prokind='f' and p.prosecdef
                                and not has_function_privilege('postgres', p.oid, 'EXECUTE')""")
    check("the API's role (owner) can still EXECUTE every SECURITY DEFINER RPC", not_callable == 0,
          f"{not_callable} not callable")

    cur.execute("""create or replace function public.zz_new_definer_fn() returns int
                   language sql security definer as $$ select 1 $$""")
    check("a NEW SECURITY DEFINER function is auto-locked (event trigger)",
          not q1(cur, "select has_function_privilege('anon','public.zz_new_definer_fn()','EXECUTE')"),
          "new definer function is anon-executable")

    cur.execute("""create or replace function public.zz_new_invoker_fn() returns int
                   language sql as $$ select 1 $$""")
    check("a NEW plain function stays callable by authenticated (RLS helpers)",
          bool(q1(cur, "select has_function_privilege('authenticated','public.zz_new_invoker_fn()','EXECUTE')")),
          "new invoker function is not executable by authenticated")

    cur.execute("drop function if exists public.zz_new_definer_fn()")
    cur.execute("drop function if exists public.zz_new_invoker_fn()")

    cur.execute("""select distinct (regexp_matches(coalesce(qual,'') || ' ' || coalesce(with_check,''),
                   '([a-z_][a-z0-9_]*)\\s*\\(', 'g'))[1]
                   from pg_policies where schemaname='public'""")
    names = [r[0] for r in cur.fetchall()]
    broken = []
    for nm in names:
        oids = q1(cur, """select array_agg(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname=%s""", [nm])
        if not oids:
            continue  # auth.* / pg_catalog helper -- not ours
        for oid in oids:
            if not q1(cur, "select has_function_privilege('authenticated', %s, 'EXECUTE')", [oid]):
                broken.append(nm)
    check("every RLS-policy helper in public is still callable by authenticated", not broken,
          f"broken: {sorted(set(broken))}")

    conn.close()

    print(f"\n==== RESULT: {len(PASS)} passed, {len(FAIL)} failed ====")
    if FAIL:
        for f in FAIL:
            print(f"  FAILED: {f}")
        print("FUNCTION-ACL INVARIANT VIOLATED")
        sys.exit(1)
    print("FUNCTION-ACL INVARIANT HOLDS")


if __name__ == "__main__":
    main()

-- 0151_function_execute_lockdown.sql
-- SECURITY (P1) — close the anon/authenticated EXECUTE surface on SECURITY DEFINER functions.
--
-- FINDING (authorisation audit 2026-09-21, docs/39). Supabase grants EXECUTE on every function
-- created in `public` to `anon` and `authenticated` BY DEFAULT PRIVILEGE -- pg_default_acl, objects
-- of type 'f': {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...}. The repo
-- already REVOKEd EXECUTE per function in 0010-0047, but every later CREATE OR REPLACE, and every
-- new overload, silently returned to that default ACL -- a new signature is a NEW function.
-- Measured in production with the PUBLIC browser anon key: 47+ SECURITY DEFINER routines were
-- reachable, including fn_admin_set_user_role, fn_admin_adjust_balance, fn_approve_withdrawal and
-- fn_admin_get_mpesa_config. SECURITY DEFINER runs as the table owner, so RLS does NOT apply to
-- them: a caller-supplied role string was all it took to escalate a role or move money.
--
-- RULE ENFORCED HERE (principled, not a blanket revoke):
--   * SECURITY DEFINER -> runs as the owner and bypasses RLS => service_role + owner ONLY.
--   * plain (invoker)  -> runs with the CALLER's privileges, is itself subject to RLS, and is what
--                         RLS policies call (is_site_admin/current_site/...) => anon/authenticated
--                         keep EXECUTE, or RLS stops evaluating.
--
-- WHY AN EVENT TRIGGER AND NOT `ALTER DEFAULT PRIVILEGES`: measured on Postgres, revoking EXECUTE
-- in DEFAULT PRIVILEGES does NOT suppress the implicit PUBLIC grant on functions -- a newly created
-- function still lands with proacl = NULL and stays anon-executable. Default privileges alone are
-- therefore NOT a durable control. The trigger below re-applies the rule to every function created
-- from now on (same pattern as the global rls_auto_enable trigger referenced in 0008/0021), and
-- packages/db/_testkit/e2e_function_acl.py fails the build if the invariant ever breaks.
--
-- Idempotent. Single command (one DO block) per the migrations README.
do $$
declare
  r record;
  v_locked int := 0;
  v_kept   int := 0;
begin
  -- 1. Install the future-proofing hook FIRST, so the helper function it defines is itself covered
  --    by the lockdown in step 2 (otherwise the helper is left anon-executable).
  execute $ddl$
    create or replace function public.fn_lock_definer_execute() returns event_trigger
    language plpgsql security definer set search_path to 'public' as $fn$
    declare r record;
    begin
      for r in
        select p.oid::regprocedure::text as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
          and (has_function_privilege('anon', p.oid, 'EXECUTE')
               or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      loop
        execute format('revoke all on function %s from public, anon, authenticated', r.sig);
        execute format('grant execute on function %s to service_role', r.sig);
      end loop;
    end $fn$;
  $ddl$;
  begin
    execute 'drop event trigger if exists lock_definer_execute';
    execute 'create event trigger lock_definer_execute on ddl_command_end '
         || 'when tag in (''CREATE FUNCTION'', ''ALTER FUNCTION'') '
         || 'execute function public.fn_lock_definer_execute()';
  exception when insufficient_privilege then
    raise notice 'lock_definer_execute event trigger not created (insufficient privilege): %', sqlerrm;
  end;

  -- 2. Lock down every SECURITY DEFINER function in `public` (including the helper above).
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    v_locked := v_locked + 1;
  end loop;

  -- 3. Plain (invoker) functions must stay callable -- RLS policies call them as `authenticated`.
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prokind='f' and not p.prosecdef
  loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
    v_kept := v_kept + 1;
  end loop;

  -- 4. Remove the implicit PUBLIC grant from every existing function (anon inherits it otherwise).
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prokind='f'
  loop
    execute format('revoke execute on function %s from public', r.sig);
  end loop;

  raise notice 'fn execute lockdown: % SECURITY DEFINER locked, % invoker functions kept callable', v_locked, v_kept;
end $$;

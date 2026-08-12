-- 0049_compat_singletenant_rpc_shims.sql — production compatibility shims (CONDITIONAL).
--
-- CONTEXT: the multi-tenant conversion lives in the `invest254-platform-template` repo. During
-- that work its migrations 0044–0048 were applied to the SHARED production Supabase DB; 0047/0048
-- replaced six money/engine RPCs with site-aware versions (extra `p_site_id`) and DROPPED the old
-- arities. The single-tenant app DEPLOYED from THIS repo still calls the old arities, so on the
-- live DB those paths began failing with `function ... does not exist` — registration-adjacent
-- trading, deposits and withdrawals (symptom: "Trade rejected — function fn_open_position(unknown,
-- ...) does not exist").
--
-- THIS MIGRATION restores each genuinely-dropped arity as a thin backward-compatible shim that
-- forwards to the site-aware function with the DEFAULT site — so the deployed single-tenant app
-- keeps working with no code change.
--
-- CONDITIONAL BY DESIGN: every shim is created ONLY IF its site-aware target actually exists. On
-- the live DB (0044–0048 applied) the shims install; on a clean single-tenant database that never
-- received the multi-tenant migrations, the targets are absent and this migration is a SAFE NO-OP.
-- That keeps the single-tenant migration chain (0001→0049) applicable to a fresh project while
-- still protecting the already-migrated production DB. Idempotent; re-running replaces the shims.
--
-- fn_register_user gets NO shim: its site-aware version declares `p_site_id DEFAULT`, so the old
-- 4-arg call already resolves via the default (a shim would make it ambiguous).

do $$
declare default_site constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  -- fn_open_position: 9-arg → 10-arg(site)
  if to_regprocedure('public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint,uuid)') is not null then
    execute format($f$
      create or replace function public.fn_open_position(
        p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric, p_duration_s integer,
        p_game_day bigint, p_nonce bigint, p_opened_at timestamptz, p_config_version bigint
      ) returns table(position_id uuid, new_balance bigint)
      language sql as $b$
        select * from public.fn_open_position($1,$2,$3,$4,$5,$6,$7,$8,$9,%L::uuid);
      $b$;$f$, default_site);
    revoke all on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint) from public, anon;
    grant execute on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint) to service_role;
  end if;

  -- fn_ensure_game_day: 2-arg → 3-arg(site)
  if to_regprocedure('public.fn_ensure_game_day(date,text,uuid)') is not null then
    execute format($f$
      create or replace function public.fn_ensure_game_day(p_date date, p_hash text)
      returns bigint language sql as $b$ select public.fn_ensure_game_day($1,$2,%L::uuid); $b$;$f$, default_site);
    revoke all on function public.fn_ensure_game_day(date,text) from public, anon;
    grant execute on function public.fn_ensure_game_day(date,text) to service_role;
  end if;

  -- fn_reveal_game_day: 2-arg → 3-arg(site)
  if to_regprocedure('public.fn_reveal_game_day(date,text,uuid)') is not null then
    execute format($f$
      create or replace function public.fn_reveal_game_day(p_date date, p_seed text)
      returns boolean language sql as $b$ select public.fn_reveal_game_day($1,$2,%L::uuid); $b$;$f$, default_site);
    revoke all on function public.fn_reveal_game_day(date,text) from public, anon;
    grant execute on function public.fn_reveal_game_day(date,text) to service_role;
  end if;

  -- fn_create_deposit: 3-arg → 4-arg(site)
  if to_regprocedure('public.fn_create_deposit(uuid,bigint,text,uuid)') is not null then
    execute format($f$
      create or replace function public.fn_create_deposit(p_user uuid, p_amount bigint, p_phone text)
      returns uuid language sql as $b$ select public.fn_create_deposit($1,$2,$3,%L::uuid); $b$;$f$, default_site);
    revoke all on function public.fn_create_deposit(uuid,bigint,text) from public, anon;
    grant execute on function public.fn_create_deposit(uuid,bigint,text) to service_role;
  end if;

  -- fn_create_withdrawal: 4-arg → 5-arg(site)
  if to_regprocedure('public.fn_create_withdrawal(uuid,bigint,text,bigint,uuid)') is not null then
    execute format($f$
      create or replace function public.fn_create_withdrawal(p_user uuid, p_amount bigint, p_phone text, p_min bigint)
      returns table(tx_id uuid, new_balance bigint)
      language sql as $b$ select * from public.fn_create_withdrawal($1,$2,$3,$4,%L::uuid); $b$;$f$, default_site);
    revoke all on function public.fn_create_withdrawal(uuid,bigint,text,bigint) from public, anon;
    grant execute on function public.fn_create_withdrawal(uuid,bigint,text,bigint) to service_role;
  end if;
end $$;

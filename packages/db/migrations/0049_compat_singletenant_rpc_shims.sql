-- 0049_compat_singletenant_rpc_shims.sql — restore the pre-multitenant RPC arities.
--
-- WHY: migrations 0047/0048 replaced six money/engine RPCs with site-aware versions that take
-- an extra `p_site_id`, and DROPPED the old arities. The engine/API build currently DEPLOYED to
-- production still calls the OLD arities, so once 0047/0048 were applied every one of these paths
-- started failing with `function ... does not exist` — registration, trading, deposits and
-- withdrawals were all down (symptom seen: "Trade rejected — function fn_open_position(unknown,
-- ...) does not exist").
--
-- FIX: re-create each dropped arity as a thin, backward-compatible shim that forwards to the new
-- site-aware function with the DEFAULT site. This is purely additive (no data touched, the
-- site-aware functions are left exactly as 0047/0048 created them), so it restores the deployed
-- single-tenant app with no code deploy while the multi-tenant code keeps using the *_site_id
-- signatures directly.
--
-- Once the multi-tenant engine/API build is deployed (it calls the site-aware arities), these
-- shims become dead weight and can be dropped in a later migration. They are safe to keep until
-- then. Idempotent: re-running replaces the shims in place.

do $$
declare default_site constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if not exists (select 1 from public.sites where id = default_site) then
    raise exception 'default site % is missing — apply 0044_sites.sql first', default_site;
  end if;
end $$;

-- ── fn_open_position (9-arg → 10-arg, default site) ──────────────────────────────────────────
create or replace function public.fn_open_position(
  p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric, p_duration_s integer,
  p_game_day bigint, p_nonce bigint, p_opened_at timestamptz, p_config_version bigint
) returns table(position_id uuid, new_balance bigint)
language sql as $$
  select * from public.fn_open_position(
    p_user, p_stake, p_direction, p_entry_rate, p_duration_s, p_game_day, p_nonce,
    p_opened_at, p_config_version, '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- ── fn_ensure_game_day (2-arg → 3-arg, default site) ─────────────────────────────────────────
create or replace function public.fn_ensure_game_day(p_date date, p_hash text)
returns bigint language sql as $$
  select public.fn_ensure_game_day(p_date, p_hash, '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- ── fn_reveal_game_day (2-arg → 3-arg, default site) ─────────────────────────────────────────
create or replace function public.fn_reveal_game_day(p_date date, p_seed text)
returns boolean language sql as $$
  select public.fn_reveal_game_day(p_date, p_seed, '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- ── fn_create_deposit (3-arg → 4-arg, default site) ──────────────────────────────────────────
create or replace function public.fn_create_deposit(p_user uuid, p_amount bigint, p_phone text)
returns uuid language sql as $$
  select public.fn_create_deposit(p_user, p_amount, p_phone, '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- ── fn_create_withdrawal (4-arg → 5-arg, default site) ───────────────────────────────────────
create or replace function public.fn_create_withdrawal(p_user uuid, p_amount bigint, p_phone text, p_min bigint)
returns table(tx_id uuid, new_balance bigint)
language sql as $$
  select * from public.fn_create_withdrawal(p_user, p_amount, p_phone, p_min, '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- NOTE: fn_register_user deliberately gets NO shim. Its site-aware version (0047) declares
-- `p_site_id uuid DEFAULT '000...001'`, so the deployed 4-arg call `fn_register_user($1..$4)`
-- already resolves to it via the default — registration was never broken. Adding a 4-arg shim
-- would create two equally-valid candidates and make the 4-arg call AMBIGUOUS, so it is omitted.

-- Mirror the grant posture of the site-aware functions (service_role only; postgres owner bypasses).
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint)',
    'public.fn_ensure_game_day(date,text)',
    'public.fn_reveal_game_day(date,text)',
    'public.fn_create_deposit(uuid,bigint,text)',
    'public.fn_create_withdrawal(uuid,bigint,text,bigint)'
  ] loop
    execute format('revoke all on function %s from public', sig);
    execute format('revoke all on function %s from anon', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;

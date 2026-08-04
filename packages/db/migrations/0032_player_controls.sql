-- 0032_player_controls.sql — Exhaustive per-player admin controls (J8).
--
-- 1) Balance ops that also cover the BONUS wallet and a one-shot CLEAR (0022 only did real credit/debit).
-- 2) A per-user overrides row the engine consults at open: win rate, auto-sell trade duration,
--    max win multiplier, and per-user stake bounds. NULL = "use the global game_config value".
--
-- All mutations are SECURITY DEFINER, role-guarded (admin/superadmin), and audited in admin_actions,
-- mirroring the 0021/0022 pattern. Idempotent to apply.

-- ── 1a. Adjust either wallet (real|bonus) by a signed amount ──────────────────────────────
create or replace function public.fn_admin_adjust_balance_kind(
  p_actor uuid, p_actor_role text, p_target uuid, p_amount bigint, p_kind text, p_reason text
) returns table(user_id uuid, kind text, amount bigint, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_new bigint; v_action bigint;
begin
  if p_actor_role not in ('admin','superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_kind not in ('real','bonus') then raise exception 'INVALID_KIND'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;

  if p_kind = 'real' then
    select w.real_balance into v_bal from wallets w where w.user_id = p_target for update;
    if not found then raise exception 'WALLET_NOT_FOUND'; end if;
    if v_bal + p_amount < 0 then raise exception 'INSUFFICIENT_FUNDS'; end if;
    update wallets set real_balance = wallets.real_balance + p_amount where wallets.user_id = p_target
      returning wallets.real_balance into v_new;
  else
    select w.bonus_balance into v_bal from wallets w where w.user_id = p_target for update;
    if not found then raise exception 'WALLET_NOT_FOUND'; end if;
    if v_bal + p_amount < 0 then raise exception 'INSUFFICIENT_FUNDS'; end if;
    update wallets set bonus_balance = wallets.bonus_balance + p_amount where wallets.user_id = p_target
      returning wallets.bonus_balance into v_new;
  end if;

  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'balance.adjust', 'user', p_target::text,
            jsonb_build_object('kind', p_kind, 'amount', p_amount, 'reason', p_reason, 'before', v_bal, 'after', v_new))
    returning id into v_action;
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
    values (p_target, 'adjustment', p_amount, p_kind, 'admin_actions', v_action::text,
            jsonb_build_object('reason', p_reason, 'actor', p_actor));
  return query select p_target, p_kind, p_amount, v_new;
end;
$fn$;

-- ── 1b. Clear a wallet (real|bonus|both) to zero in one guarded, audited move ───────────────
create or replace function public.fn_admin_clear_balance(
  p_actor uuid, p_actor_role text, p_target uuid, p_kind text, p_reason text
) returns table(user_id uuid, real_balance bigint, bonus_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_real bigint; v_bonus bigint; v_action bigint;
begin
  if p_actor_role not in ('admin','superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_kind not in ('real','bonus','both') then raise exception 'INVALID_KIND'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;

  select w.real_balance, w.bonus_balance into v_real, v_bonus from wallets w where w.user_id = p_target for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;

  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'balance.clear', 'user', p_target::text,
            jsonb_build_object('kind', p_kind, 'reason', p_reason, 'before_real', v_real, 'before_bonus', v_bonus))
    returning id into v_action;

  if p_kind in ('real','both') and v_real <> 0 then
    update wallets set real_balance = 0 where wallets.user_id = p_target;
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
      values (p_target, 'adjustment', -v_real, 'real', 'admin_actions', v_action::text,
              jsonb_build_object('reason', p_reason, 'actor', p_actor, 'clear', true));
  end if;
  if p_kind in ('bonus','both') and v_bonus <> 0 then
    update wallets set bonus_balance = 0 where wallets.user_id = p_target;
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
      values (p_target, 'adjustment', -v_bonus, 'bonus', 'admin_actions', v_action::text,
              jsonb_build_object('reason', p_reason, 'actor', p_actor, 'clear', true));
  end if;

  select w.real_balance, w.bonus_balance into v_real, v_bonus from wallets w where w.user_id = p_target;
  return query select p_target, v_real, v_bonus;
end;
$fn$;

-- ── 2. Per-user overrides the engine consults at open ──────────────────────────────────────
create table if not exists public.user_overrides (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  win_rate           numeric,     -- target fraction of this user's trades that win (0,1]; null = global
  trade_duration_s   integer,     -- forced auto-sell duration (1..3600); null = global default
  max_win_multiplier numeric,     -- per-user cap on payout multiple (>1); null = global
  min_stake          bigint,      -- per-user min stake (cents, >0); null = global
  max_stake          bigint,      -- per-user max stake (cents, >= min); null = global
  notes              text,
  updated_by         uuid,
  updated_at         timestamptz not null default now(),
  constraint chk_user_overrides_win_rate   check (win_rate is null or (win_rate > 0 and win_rate <= 1)),
  constraint chk_user_overrides_duration   check (trade_duration_s is null or (trade_duration_s between 1 and 3600)),
  constraint chk_user_overrides_maxmult    check (max_win_multiplier is null or max_win_multiplier > 1),
  constraint chk_user_overrides_min_stake  check (min_stake is null or min_stake > 0),
  constraint chk_user_overrides_max_stake  check (max_stake is null or (min_stake is null or max_stake >= min_stake))
);

alter table public.user_overrides enable row level security;  -- service-role only; no policy

-- Upsert a partial patch of overrides (null in the patch = leave that field unchanged; to CLEAR a
-- field back to the global default, send the JSON literal null wrapped in a `{ "<field>": null }` with
-- the sentinel handled in app code, or use fn_admin_clear_user_override). Audited.
create or replace function public.fn_admin_set_user_overrides(
  p_actor uuid, p_actor_role text, p_target uuid, p_patch jsonb
) returns public.user_overrides
language plpgsql security definer set search_path = public
as $fn$
declare v_row public.user_overrides; v_before jsonb;
begin
  if p_actor_role not in ('admin','superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_PATCH'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then raise exception 'USER_NOT_FOUND'; end if;

  select to_jsonb(o) into v_before from public.user_overrides o where o.user_id = p_target;

  insert into public.user_overrides as u (user_id, win_rate, trade_duration_s, max_win_multiplier, min_stake, max_stake, notes, updated_by, updated_at)
  values (
    p_target,
    case when p_patch ? 'win_rate'           then nullif(p_patch->>'win_rate','')::numeric        else null end,
    case when p_patch ? 'trade_duration_s'   then nullif(p_patch->>'trade_duration_s','')::int    else null end,
    case when p_patch ? 'max_win_multiplier' then nullif(p_patch->>'max_win_multiplier','')::numeric else null end,
    case when p_patch ? 'min_stake'          then nullif(p_patch->>'min_stake','')::bigint        else null end,
    case when p_patch ? 'max_stake'          then nullif(p_patch->>'max_stake','')::bigint        else null end,
    case when p_patch ? 'notes'              then nullif(p_patch->>'notes','')                    else null end,
    p_actor, now()
  )
  on conflict (user_id) do update set
    win_rate           = case when p_patch ? 'win_rate'           then nullif(p_patch->>'win_rate','')::numeric        else u.win_rate end,
    trade_duration_s   = case when p_patch ? 'trade_duration_s'   then nullif(p_patch->>'trade_duration_s','')::int    else u.trade_duration_s end,
    max_win_multiplier = case when p_patch ? 'max_win_multiplier' then nullif(p_patch->>'max_win_multiplier','')::numeric else u.max_win_multiplier end,
    min_stake          = case when p_patch ? 'min_stake'          then nullif(p_patch->>'min_stake','')::bigint        else u.min_stake end,
    max_stake          = case when p_patch ? 'max_stake'          then nullif(p_patch->>'max_stake','')::bigint        else u.max_stake end,
    notes              = case when p_patch ? 'notes'              then nullif(p_patch->>'notes','')                    else u.notes end,
    updated_by = p_actor, updated_at = now()
  returning * into v_row;

  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'user.overrides', 'user', p_target::text,
            jsonb_build_object('patch', p_patch, 'before', v_before, 'after', to_jsonb(v_row)));
  return v_row;
end;
$fn$;

do $mig$
begin
  grant execute on function public.fn_admin_adjust_balance_kind(uuid, text, uuid, bigint, text, text) to authenticated, service_role;
  grant execute on function public.fn_admin_clear_balance(uuid, text, uuid, text, text) to authenticated, service_role;
  grant execute on function public.fn_admin_set_user_overrides(uuid, text, uuid, jsonb) to authenticated, service_role;
end
$mig$;

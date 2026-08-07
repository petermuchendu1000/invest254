-- 0037_deposit_bonuses.sql — Tiered deposit bonuses with wagering requirements.
--
-- Bonus tiers (of the successful deposit amount, credited to bonus_balance):
--   KES 1,000–5,000      -> 50%
--   > KES 5,000–10,000   -> 25%
--   > KES 10,000         -> 15%
--   below KES 1,000      -> no bonus
-- Every bonus carries a 10x wagering requirement: stakes (real+bonus) accumulate
-- progress; when wagered >= amount * wagering_x the remaining bonus converts to
-- real, withdrawable balance. Bonus funds are stake-able but NOT withdrawable
-- (fn_create_withdrawal / fn_marketer_game_withdraw debit real_balance only).
--
-- All money movement stays inside SECURITY DEFINER RPCs (service-role only),
-- mirroring the 0010/0014 atomic pattern: lock wallet FOR UPDATE, mutate, ledger.

-- ── Config (admin-tunable, singleton) ────────────────────────────────────────
create table if not exists public.bonus_config (
  id         int primary key default 1 check (id = 1),
  enabled    boolean not null default true,
  wagering_x numeric not null default 10.0 check (wagering_x >= 0),
  -- tiers: jsonb array of {min_cents, max_cents (null = unbounded), pct}
  tiers      jsonb not null default '[
    {"min_cents": 100000,  "max_cents": 500000,  "pct": 0.50},
    {"min_cents": 500001,  "max_cents": 1000000, "pct": 0.25},
    {"min_cents": 1000001, "max_cents": null,    "pct": 0.15}
  ]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.bonus_config(id) values (1) on conflict (id) do nothing;

-- ── Bonus ledger extensions ──────────────────────────────────────────────────
-- bonuses table (0007) already has: amount, wagering_x, wagered, status.
alter table public.bonuses drop constraint if exists bonuses_type_check;
alter table public.bonuses add constraint bonuses_type_check
  check (type in ('welcome','promo','manual','deposit'));
alter table public.bonuses add column if not exists deposit_tx_id uuid references public.transactions(id);
alter table public.bonuses add column if not exists converted_at timestamptz;
create unique index if not exists idx_bonuses_deposit_tx on public.bonuses(deposit_tx_id);

-- ── fn_deposit_bonus_pct: pure tier lookup ───────────────────────────────────
create or replace function public.fn_deposit_bonus_pct(p_amount bigint)
returns numeric language plpgsql stable security definer set search_path = public
as $fn$
declare v_cfg public.bonus_config%rowtype; v_tier jsonb;
        v_min bigint; v_max bigint;
begin
  select * into v_cfg from bonus_config where id = 1;
  if not found or not v_cfg.enabled then return 0; end if;
  for v_tier in select * from jsonb_array_elements(v_cfg.tiers) loop
    v_min := (v_tier->>'min_cents')::bigint;
    v_max := nullif(v_tier->>'max_cents','')::bigint;
    if p_amount >= v_min and (v_max is null or p_amount <= v_max) then
      return (v_tier->>'pct')::numeric;
    end if;
  end loop;
  return 0;
end;
$fn$;

-- ── fn_complete_deposit: credit deposit + grant tiered bonus (idempotent) ────
create or replace function public.fn_complete_deposit(
  p_checkout text, p_result_code int, p_result_desc text, p_receipt text, p_raw jsonb
) returns table(applied boolean, status text, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_tx public.transactions%rowtype; v_bal bigint;
        v_pct numeric; v_bonus bigint; v_wx numeric; v_bonus_id uuid;
begin
  select * into v_tx from transactions where checkout_request_id = p_checkout and kind = 'deposit' for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if v_tx.status in ('success','failed') then           -- idempotent: terminal already
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select false, v_tx.status, v_bal; return;
  end if;
  if p_result_code = 0 then
    update transactions set status='success', result_code=p_result_code, result_desc=p_result_desc,
           mpesa_receipt=p_receipt, raw_callback=p_raw where id = v_tx.id;
    update wallets set real_balance = real_balance + v_tx.amount where user_id = v_tx.user_id;
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
      values (v_tx.user_id, 'deposit', v_tx.amount, 'real', 'transactions', v_tx.id::text,
              jsonb_build_object('receipt', p_receipt));
    -- tiered deposit bonus (unique index on deposit_tx_id makes re-entry a no-op)
    v_pct := public.fn_deposit_bonus_pct(v_tx.amount);
    if v_pct > 0 then
      v_bonus := floor(v_tx.amount * v_pct);
      select wagering_x into v_wx from bonus_config where id = 1;
      if v_bonus > 0 then
        insert into bonuses(user_id, type, amount, wagering_x, deposit_tx_id)
          values (v_tx.user_id, 'deposit', v_bonus, v_wx, v_tx.id)
          on conflict (deposit_tx_id) do nothing
          returning id into v_bonus_id;
        if v_bonus_id is not null then
          update wallets set bonus_balance = bonus_balance + v_bonus where user_id = v_tx.user_id;
          insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
            values (v_tx.user_id, 'bonus', v_bonus, 'bonus', 'transactions', v_tx.id::text,
                    jsonb_build_object('kind', 'deposit_bonus', 'pct', v_pct,
                                       'wagering_x', v_wx, 'deposit_amount', v_tx.amount));
        end if;
      end if;
    end if;
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select true, 'success', v_bal; return;
  else
    update transactions set status='failed', result_code=p_result_code, result_desc=p_result_desc,
           raw_callback=p_raw where id = v_tx.id;
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select true, 'failed', v_bal; return;
  end if;
end;
$fn$;

-- ── fn_open_position: stake draws bonus first, then real; accrues wagering ───
create or replace function public.fn_open_position(
  p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric,
  p_duration_s int, p_game_day bigint, p_nonce bigint
) returns table(position_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_real bigint; v_bonus bigint; v_from_bonus bigint; v_from_real bigint; v_id uuid;
begin
  if p_stake <= 0 then raise exception 'INVALID_STAKE'; end if;
  if p_direction not in ('buy','sell') then raise exception 'INVALID_DIRECTION'; end if;
  select real_balance, bonus_balance into v_real, v_bonus
    from wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_real + v_bonus < p_stake then raise exception 'INSUFFICIENT_FUNDS'; end if;
  v_from_bonus := least(v_bonus, p_stake);
  v_from_real  := p_stake - v_from_bonus;
  update wallets set bonus_balance = bonus_balance - v_from_bonus,
                     real_balance  = real_balance  - v_from_real
   where user_id = p_user returning real_balance into v_real;
  v_id := gen_random_uuid();
  -- committed outcome intentionally NOT stored (player cannot read result pre-settle)
  insert into positions(id, user_id, game_day_id, direction, stake, entry_rate, duration_s, status, nonce)
    values (v_id, p_user, p_game_day, p_direction, p_stake, p_entry_rate, p_duration_s, 'open', p_nonce);
  if v_from_real > 0 then
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
      values (p_user, 'stake', -v_from_real, 'real', 'positions', v_id::text);
  end if;
  if v_from_bonus > 0 then
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
      values (p_user, 'stake', -v_from_bonus, 'bonus', 'positions', v_id::text);
  end if;
  -- wagering progress: every staked shilling counts toward active bonuses (FIFO)
  update bonuses set wagered = wagered + p_stake
   where user_id = p_user and status = 'active';
  return query select v_id, v_real;
end;
$fn$;

-- ── fn_settle_position: payout to real; convert cleared bonuses (FIFO) ───────
create or replace function public.fn_settle_position(
  p_position uuid, p_exit_rate numeric, p_result text, p_multiplier numeric, p_payout bigint
) returns table(settled boolean, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_status text; v_user uuid; v_stake bigint; v_bal bigint;
        v_bonus record; v_convert bigint;
begin
  if p_result not in ('win','loss','void') then raise exception 'INVALID_RESULT'; end if;
  if p_payout < 0 then raise exception 'INVALID_PAYOUT'; end if;
  select status, user_id, stake into v_status, v_user, v_stake
    from positions where id = p_position for update;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;
  if v_status <> 'open' then
    select real_balance into v_bal from wallets where user_id = v_user;
    return query select false, v_bal; return;
  end if;
  update positions set status='settled', exit_rate=p_exit_rate, result=p_result,
    multiplier = nullif(p_multiplier, 0), payout = p_payout, pnl = p_payout - v_stake, settled_at = now()
   where id = p_position;
  if p_payout > 0 then
    update wallets set real_balance = real_balance + p_payout where user_id = v_user;
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
      values (v_user, 'payout', p_payout, 'real', 'positions', p_position::text);
  end if;
  -- wagering conversion: bonuses whose requirement is met convert to real (FIFO by created_at)
  for v_bonus in
    select id, amount, wagering_x, wagered from bonuses
     where user_id = v_user and status = 'active'
       and wagered >= floor(amount * wagering_x)
     order by created_at for update
  loop
    select bonus_balance into v_convert from wallets where user_id = v_user;
    v_convert := least(v_convert, v_bonus.amount);
    if v_convert > 0 then
      update wallets set bonus_balance = bonus_balance - v_convert,
                         real_balance  = real_balance  + v_convert
       where user_id = v_user;
      insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
        values (v_user, 'bonus', v_convert, 'real', 'bonuses', v_bonus.id::text,
                jsonb_build_object('kind', 'wagering_conversion', 'wagered', v_bonus.wagered,
                                   'required', floor(v_bonus.amount * v_bonus.wagering_x)));
    end if;
    update bonuses set status = 'cleared', converted_at = now() where id = v_bonus.id;
  end loop;
  select real_balance into v_bal from wallets where user_id = v_user;
  return query select true, v_bal;
end;
$fn$;

-- ── fn_wallet_bonus_status: player-facing wagering progress ──────────────────
create or replace function public.fn_wallet_bonus_status(p_user uuid)
returns table(bonus_id uuid, amount bigint, wagering_x numeric, wagered bigint,
              required bigint, remaining bigint, status text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $fn$
begin
  return query
    select b.id, b.amount, b.wagering_x, b.wagered,
           floor(b.amount * b.wagering_x)::bigint as required,
           greatest(0, floor(b.amount * b.wagering_x)::bigint - b.wagered) as remaining,
           b.status, b.created_at
      from bonuses b
     where b.user_id = p_user and b.status = 'active'
     order by b.created_at;
end;
$fn$;

-- ── Grants: service-role only (player reads go through the API) ──────────────
do $g$
begin
  revoke all on function public.fn_deposit_bonus_pct(bigint)                          from public;
  revoke all on function public.fn_complete_deposit(text,int,text,text,jsonb)         from public;
  revoke all on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint) from public;
  revoke all on function public.fn_settle_position(uuid,numeric,text,numeric,bigint)  from public;
  revoke all on function public.fn_wallet_bonus_status(uuid)                          from public;
  grant execute on function public.fn_deposit_bonus_pct(bigint)                          to service_role;
  grant execute on function public.fn_complete_deposit(text,int,text,text,jsonb)         to service_role;
  grant execute on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint) to service_role;
  grant execute on function public.fn_settle_position(uuid,numeric,text,numeric,bigint)  to service_role;
  grant execute on function public.fn_wallet_bonus_status(uuid)                          to service_role;
end
$g$;

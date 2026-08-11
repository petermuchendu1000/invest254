-- 0047_site_money_rpcs.sql — Make the core money RPCs site-aware (multi-tenant).
--
-- WHY: 0045 gave every tenant table a `site_id` with a DEFAULT of the default site. That keeps
-- old code working, but it also means an unmodified RPC would silently stamp EVERY row with the
-- default site — so a deposit/stake/payout on Brand B would be mis-attributed to Brand A. This
-- migration threads `site_id` explicitly through the money chokepoints so each row lands on the
-- correct brand:
--   * fn_register_user   — per-site identity uniqueness + referral resolved WITHIN the site
--   * fn_open_position   — stake bounds from that site's config; position + stake ledger stamped
--   * fn_settle_position — payout ledger stamped with the POSITION's site (derived, not defaulted)
--   * fn_affiliate_enroll — affiliate row stamped with the enrolling user's site
--
-- Single source of truth preserved: one open path, one settle path. SECURITY DEFINER,
-- service-role only, idempotent. Applied + e2e-tested on a local Postgres (two isolated sites).

do $mig$
declare default_site constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  -- Identity is self-managed since 0015 (profiles.id no longer references auth.users), but the
  -- column never got its own default — Supabase Auth used to supply the id. fn_register_user
  -- inserts a profile WITHOUT an id, so guarantee the column self-generates one.
  alter table public.profiles alter column id set default gen_random_uuid();

  -- positions.config_version previously FK'd game_config_versions(version) (single-tenant).
  -- In multi-tenant the pricing version comes from site_game_config_versions(site_id, version),
  -- so drop the single-tenant FK; integrity is enforced by (site_id, config_version) logically.
  alter table public.positions drop constraint if exists positions_config_version_fkey;
end
$mig$;

-- ── fn_register_user (site-aware; one signature, site defaults to the default site) ─────────
drop function if exists public.fn_register_user(text, text, text);
drop function if exists public.fn_register_user(text, text, text, text);

create or replace function public.fn_register_user(
  p_phone text, p_username text, p_password_hash text,
  p_referral_code text default null,
  p_site_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(user_id uuid, role text)
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid; v_aff uuid; v_code text;
begin
  if p_phone is null or length(p_phone) < 8 then raise exception 'INVALID_PHONE'; end if;
  if p_username is null or length(p_username) < 3 then raise exception 'INVALID_USERNAME'; end if;
  if p_password_hash is null or length(p_password_hash) < 20 then raise exception 'INVALID_HASH'; end if;
  if not exists (select 1 from sites s where s.id = p_site_id) then raise exception 'SITE_NOT_FOUND'; end if;
  -- Uniqueness is PER SITE: the same phone/username may exist on a different brand.
  if exists (select 1 from profiles where phone = p_phone and site_id = p_site_id) then raise exception 'PHONE_TAKEN'; end if;
  if exists (select 1 from profiles where username = p_username and site_id = p_site_id) then raise exception 'USERNAME_TAKEN'; end if;
  insert into profiles(phone, username, site_id) values (p_phone, p_username, p_site_id) returning id into v_id;
  insert into wallets(user_id, site_id) values (v_id, p_site_id);
  insert into user_credentials(user_id, password_hash) values (v_id, p_password_hash);
  -- First-touch, permanent referral attribution, resolved WITHIN this site only.
  v_code := nullif(upper(btrim(p_referral_code)), '');
  if v_code is not null then
    select a.user_id into v_aff from affiliates a
      where a.referral_code = v_code and a.status = 'active' and a.site_id = p_site_id;
    if v_aff is not null and v_aff <> v_id then
      update profiles set referred_by = v_aff where id = v_id;
      insert into referrals(affiliate_id, referred_user, site_id) values (v_aff, v_id, p_site_id);
    end if;
  end if;
  return query select v_id, (select pr.role from profiles pr where pr.id = v_id);
exception
  when unique_violation then raise exception 'REGISTRATION_CONFLICT';
end
$fn$;

-- ── fn_open_position (site-aware; stake bounds from that site's config) ─────────────────────
drop function if exists public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz);
drop function if exists public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint);

create or replace function public.fn_open_position(
  p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric,
  p_duration_s int, p_game_day bigint, p_nonce bigint, p_opened_at timestamptz,
  p_config_version bigint, p_site_id uuid
) returns table(position_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_id uuid; v_min bigint; v_max bigint;
begin
  if p_stake <= 0 then raise exception 'INVALID_STAKE'; end if;
  if p_direction not in ('buy','sell') then raise exception 'INVALID_DIRECTION'; end if;

  -- Live stake bounds for THIS brand (defence in depth; last gate before money moves).
  select min_stake, max_stake into v_min, v_max from site_game_config where site_id = p_site_id;
  if v_min is not null and p_stake < v_min then raise exception 'STAKE_BELOW_MIN'; end if;
  if v_max is not null and p_stake > v_max then raise exception 'STAKE_ABOVE_MAX'; end if;

  -- Lock the wallet and confirm it belongs to this site (cross-site open is impossible).
  select real_balance into v_bal from wallets where user_id = p_user and site_id = p_site_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_stake then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_stake where user_id = p_user
    returning real_balance into v_bal;
  v_id := gen_random_uuid();
  insert into positions(id, user_id, site_id, game_day_id, direction, stake, entry_rate, duration_s,
                        status, nonce, opened_at, config_version)
    values (v_id, p_user, p_site_id, p_game_day, p_direction, p_stake, p_entry_rate, p_duration_s,
            'open', p_nonce, p_opened_at, p_config_version);
  insert into ledger_entries(user_id, site_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, p_site_id, 'stake', -p_stake, 'real', 'positions', v_id::text);
  return query select v_id, v_bal;
end;
$fn$;

-- ── fn_settle_position (stamps the payout ledger with the POSITION's site, not the default) ──
create or replace function public.fn_settle_position(
  p_position uuid, p_exit_rate numeric, p_result text, p_multiplier numeric, p_payout bigint
) returns table(settled boolean, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_status text; v_user uuid; v_stake bigint; v_bal bigint; v_site uuid;
begin
  if p_result not in ('win','loss','void') then raise exception 'INVALID_RESULT'; end if;
  if p_payout < 0 then raise exception 'INVALID_PAYOUT'; end if;
  select status, user_id, stake, site_id into v_status, v_user, v_stake, v_site
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
    update wallets set real_balance = real_balance + p_payout where user_id = v_user
      returning real_balance into v_bal;
    insert into ledger_entries(user_id, site_id, type, amount, balance_kind, ref_table, ref_id)
      values (v_user, v_site, 'payout', p_payout, 'real', 'positions', p_position::text);
  else
    select real_balance into v_bal from wallets where user_id = v_user;
  end if;
  return query select true, v_bal;
end;
$fn$;

-- ── fn_affiliate_enroll (affiliate row stamped with the enrolling user's site) ──────────────
create or replace function public.fn_affiliate_enroll(p_user uuid)
returns table(referral_code text, commission_rate numeric, status text, role text)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text; i int; v_site uuid;
  v_rc text; v_rate numeric; v_status text; v_role text;
begin
  select site_id into v_site from profiles where id = p_user;
  if v_site is null then raise exception 'USER_NOT_FOUND'; end if;
  if not exists (select 1 from affiliates where user_id = p_user) then
    loop
      v_code := '';
      for i in 1..8 loop
        v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from affiliates a where a.referral_code = v_code);
    end loop;
    insert into affiliates(user_id, referral_code, site_id) values (p_user, v_code, v_site);
    update profiles set role = 'marketer' where id = p_user and profiles.role = 'player';
  end if;
  select a.referral_code, a.commission_rate, a.status, pr.role
    into v_rc, v_rate, v_status, v_role
    from affiliates a join profiles pr on pr.id = a.user_id
   where a.user_id = p_user;
  return query select v_rc, v_rate, v_status, v_role;
end
$fn$;

-- ── Grants (service-role only) ──────────────────────────────────────────────────────────────
revoke all on function public.fn_register_user(text,text,text,text,uuid) from public;
grant execute on function public.fn_register_user(text,text,text,text,uuid) to service_role;
revoke all on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint,uuid) from public;
grant execute on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint,uuid) to service_role;
revoke all on function public.fn_settle_position(uuid,numeric,text,numeric,bigint) from public;
grant execute on function public.fn_settle_position(uuid,numeric,text,numeric,bigint) to service_role;
revoke all on function public.fn_affiliate_enroll(uuid) from public;
grant execute on function public.fn_affiliate_enroll(uuid) to service_role;

-- 0095_welcome_bonus.sql
-- Task 2 — every new signup receives a 200 KES welcome bonus as REAL (withdrawable) credit.
--
-- Redefines fn_register_user (latest def: 0047) to, in the same transaction as account creation,
-- credit the wallet's real_balance by 20,000 cents, record a cleared 'welcome' bonus row (no
-- wagering) and a 'bonus' ledger entry (balance_kind='real'). Real credit — not the 'bonus'
-- wallet bucket — so it is immediately spendable/withdrawable and nudges the first deposit.
--
-- Reporting is unaffected: deposit totals come from `transactions` (kind='deposit'), never from
-- ledger_entries, so this credit is correctly counted as a liability/cost, not a deposit.
-- Only the player self-registration path calls this RPC, so the bonus is granted exactly once.

create or replace function public.fn_register_user(
  p_phone text, p_username text, p_password_hash text,
  p_referral_code text default null,
  p_site_id uuid default '00000000-0000-0000-0000-000000000001'
)
returns table(user_id uuid, role text)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_id uuid; v_aff uuid; v_code text; v_bonus uuid;
  v_welcome_cents constant bigint := 20000;  -- 200 KES, real & withdrawable
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

  -- ── Welcome bonus: 200 KES real (withdrawable) credit for every new signup ──
  -- (wallets.user_id / wallets.site_id are qualified to avoid clashing with the OUT param user_id.)
  update wallets
     set real_balance = wallets.real_balance + v_welcome_cents, updated_at = now()
   where wallets.user_id = v_id and wallets.site_id = p_site_id;
  insert into bonuses(user_id, type, amount, wagering_x, wagered, status, site_id)
    values (v_id, 'welcome', v_welcome_cents, 0, 0, 'cleared', p_site_id)
    returning id into v_bonus;
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta, site_id)
    values (v_id, 'bonus', v_welcome_cents, 'real', 'bonuses', v_bonus::text,
            jsonb_build_object('source', 'welcome_bonus'), p_site_id);

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

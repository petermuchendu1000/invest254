-- 0017 affiliate enrollment + first-touch referral attribution
-- M5 (affiliate) foundation. Two data-integrity invariants live in the RPCs (the only
-- un-bypassable chokepoints) so they can't be skipped by any transport:
--   1. Enrollment is idempotent: a player becomes a marketer exactly once, with one stable,
--      unique, URL-safe referral_code (Crockford-style alphabet, no 0/O/1/I/L ambiguity).
--   2. Attribution is captured atomically with account creation -> first-touch & permanent
--      (referrals.referred_user is UNIQUE; it can only ever be written at registration).
-- Both functions are SECURITY DEFINER + service-role only (the engine holds the connection).
-- A stale/unknown/suspended referral code never blocks a signup: it is silently ignored.

-- 1) Re-create fn_register_user with an optional referral code (drops the 3-arg 0015 form so
--    there is a single, unambiguous signature). The attribution block is additive; the rest is
--    byte-for-byte the 0015 body. Self-referral is structurally impossible (phone is unique, so
--    a brand-new account can never be the referring affiliate).
drop function if exists public.fn_register_user(text, text, text);

create or replace function public.fn_register_user(
  p_phone text, p_username text, p_password_hash text, p_referral_code text default null
)
returns table(user_id uuid, role text)
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid; v_aff uuid; v_code text;
begin
  if p_phone is null or length(p_phone) < 8 then raise exception 'INVALID_PHONE'; end if;
  if p_username is null or length(p_username) < 3 then raise exception 'INVALID_USERNAME'; end if;
  if p_password_hash is null or length(p_password_hash) < 20 then raise exception 'INVALID_HASH'; end if;
  if exists (select 1 from profiles where phone = p_phone) then raise exception 'PHONE_TAKEN'; end if;
  if exists (select 1 from profiles where username = p_username) then raise exception 'USERNAME_TAKEN'; end if;
  insert into profiles(phone, username) values (p_phone, p_username) returning id into v_id;
  insert into wallets(user_id) values (v_id);
  insert into user_credentials(user_id, password_hash) values (v_id, p_password_hash);
  -- First-touch, permanent referral attribution (best-effort: unknown/suspended code -> ignored).
  v_code := nullif(upper(btrim(p_referral_code)), '');
  if v_code is not null then
    select a.user_id into v_aff from affiliates a where a.referral_code = v_code and a.status = 'active';
    if v_aff is not null and v_aff <> v_id then
      update profiles set referred_by = v_aff where id = v_id;
      insert into referrals(affiliate_id, referred_user) values (v_aff, v_id);
    end if;
  end if;
  return query select v_id, (select pr.role from profiles pr where pr.id = v_id);
exception
  when unique_violation then raise exception 'REGISTRATION_CONFLICT';
end
$fn$;

-- 2) Idempotent affiliate enrollment: first call mints a unique code + promotes player->marketer;
--    repeat calls return the existing affiliate row unchanged (never downgrades a privileged role).
create or replace function public.fn_affiliate_enroll(p_user uuid)
returns table(referral_code text, commission_rate numeric, status text, role text)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- no 0/O/1/I/L
  v_code text;
  i int;
  -- distinct locals: returning table columns whose names equal the OUT params (status/role/...)
  -- triggers a variable/column ambiguity, so select into locals and return those (0016 pattern).
  v_rc text; v_rate numeric; v_status text; v_role text;
begin
  if not exists (select 1 from profiles where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
  if not exists (select 1 from affiliates where user_id = p_user) then
    loop
      v_code := '';
      for i in 1..8 loop
        v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from affiliates a where a.referral_code = v_code);
    end loop;
    insert into affiliates(user_id, referral_code) values (p_user, v_code);
    -- qualify the WHERE column: a bare `role` collides with the OUT param of the same name.
    update profiles set role = 'marketer' where id = p_user and profiles.role = 'player';
  end if;
  select a.referral_code, a.commission_rate, a.status, pr.role
    into v_rc, v_rate, v_status, v_role
    from affiliates a join profiles pr on pr.id = a.user_id
   where a.user_id = p_user;
  return query select v_rc, v_rate, v_status, v_role;
end
$fn$;

-- 3) Grants: service-role only. Plain statements (a DO-block GRANT cannot resolve a freshly
--    created function over the runtime SQL channel). The 3-arg fn_register_user grants vanished
--    with the DROP above, so the 4-arg form is re-granted from scratch.
revoke all on function public.fn_register_user(text,text,text,text) from public;
revoke all on function public.fn_register_user(text,text,text,text) from anon;
revoke all on function public.fn_register_user(text,text,text,text) from authenticated;
grant execute on function public.fn_register_user(text,text,text,text) to service_role;

revoke all on function public.fn_affiliate_enroll(uuid) from public;
revoke all on function public.fn_affiliate_enroll(uuid) from anon;
revoke all on function public.fn_affiliate_enroll(uuid) from authenticated;
grant execute on function public.fn_affiliate_enroll(uuid) to service_role;

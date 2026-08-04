-- 0036_marketer_game_withdraw.sql
--
-- Marketers are players, identified by PHONE. When a marketer withdraws game winnings on
-- invest254, the money does NOT go out via Daraja/M-Pesa; it is transferred INSTANTLY into
-- that phone's mpesa-app (marketer) wallet, which the mpesa app shows in real time.
--
-- Also: the whole system now uses the LOCAL phone form (0XXXXXXXXX) as the canonical identity.
-- profiles.phone was migrated 254XXXXXXXXX -> 0XXXXXXXXX; normalizeMsisdn() returns the local
-- form and msisdnToE164() converts to 254 only at the Safaricom/Daraja edge.

-- Backfill existing identities to the local form (idempotent).
UPDATE public.profiles SET phone = '0' || substr(phone, 4) WHERE phone ~ '^254(7|1)[0-9]{8}$';

-- Instant game -> mpesa transfer. Returns is_marketer=false (no side effects) when the player's
-- phone is not a marketer, so the caller falls back to the normal (Daraja) withdrawal.
CREATE OR REPLACE FUNCTION public.fn_marketer_game_withdraw(p_user uuid, p_amount bigint)
 RETURNS TABLE(is_marketer boolean, tx_id uuid, new_balance bigint, mpesa_balance bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_phone text; v_pstatus text; v_local text; v_mid uuid; v_mstatus text; v_bal bigint; v_id uuid; v_mpesa bigint;
begin
  select phone, status into v_phone, v_pstatus from profiles where id = p_user;
  if v_phone is null then raise exception 'WALLET_NOT_FOUND'; end if;
  v_local := regexp_replace(coalesce(v_phone,''), '^\+', '');
  if v_local ~ '^254(7|1)[0-9]{8}$' then v_local := '0' || substr(v_local, 4);
  elsif v_local ~ '^(7|1)[0-9]{8}$' then v_local := '0' || v_local;
  end if;

  select id, status into v_mid, v_mstatus from marketers where phone = v_local;
  if v_mid is null then
    return query select false, null::uuid, null::bigint, null::bigint;
    return;
  end if;
  -- A limited player OR a limited marketer cannot cash out (account-status gate).
  if v_pstatus is distinct from 'active' or v_mstatus is distinct from 'active' then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select real_balance into v_bal from wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_amount where user_id = p_user returning real_balance into v_bal;

  insert into transactions(user_id, kind, amount, status, provider, phone)
    values (p_user, 'withdrawal', p_amount, 'success', 'internal', v_local) returning id into v_id;
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, 'withdrawal', -p_amount, 'real', 'transactions', v_id::text);

  v_mpesa := public.fn_marketer_credit(v_mid, p_amount, 'game:'||v_id::text,
               jsonb_build_object('source','game_withdrawal','tx', v_id::text));

  return query select true, v_id, v_bal, v_mpesa;
end;
$function$;

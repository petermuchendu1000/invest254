-- 0019 affiliate payouts (M5): marketer request -> admin approve/reject -> M-Pesa B2C result.
-- Mirrors the 0014 withdrawal hold->approve->B2C-result->complete/reverse pattern. A payout
-- RESERVES the exact accrued commission buckets it covers via affiliate_commissions.payout_id
-- (a clean snapshot taken at request time): available commission = accrued AND payout_id IS NULL.
-- On success the reserved buckets move accrued -> paid (their sum equals the payout amount by
-- construction); on failure/rejection the reservation is released and they stay accrued for a
-- future payout. All RPCs are SECURITY DEFINER, service-role only, idempotent, and money-correct
-- under FOR UPDATE row locks. Money is BIGINT cents (KES).

-- ── schema: payout audit columns + commission reservation link ──────────────────────────────
-- One atomic DO block so the catalog mutations on each table run sequentially (no pg_class race).
do $mig$
begin
  alter table public.affiliate_payouts     add column if not exists paid_at         timestamptz;
  alter table public.affiliate_payouts     add column if not exists conversation_id text;
  alter table public.affiliate_payouts     add column if not exists mpesa_receipt   text;
  alter table public.affiliate_payouts     add column if not exists result_code     int;
  alter table public.affiliate_payouts     add column if not exists result_desc     text;
  alter table public.affiliate_payouts     add column if not exists raw_callback    jsonb;
  alter table public.affiliate_commissions add column if not exists payout_id       uuid references public.affiliate_payouts(id);
  create index if not exists idx_commission_payout  on public.affiliate_commissions(payout_id);
  create index if not exists idx_payout_affiliate   on public.affiliate_payouts(affiliate_id, status);
end
$mig$;

-- ── request: marketer claims their available commission ─────────────────────────────────────
-- Sums the caller's unreserved accrued buckets (FOR UPDATE), refuses if a payout is already in
-- flight, inserts the request for that exact amount, and reserves the covered buckets by
-- stamping their payout_id. Raises PAYOUT_PENDING / NO_AVAILABLE_COMMISSION.
create or replace function public.fn_affiliate_request_payout(p_user uuid)
returns table(payout_id uuid, amount bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_available bigint; v_payout uuid;
begin
  if exists (select 1 from affiliate_payouts ap
              where ap.affiliate_id = p_user and ap.status in ('requested','approved')) then
    raise exception 'PAYOUT_PENDING';
  end if;
  -- lock the unreserved accrued buckets so a concurrent request can't double-claim them
  perform 1 from affiliate_commissions ac
    where ac.affiliate_id = p_user and ac.status = 'accrued' and ac.payout_id is null
    for update;
  select coalesce(sum(ac.commission), 0)::bigint into v_available
    from affiliate_commissions ac
   where ac.affiliate_id = p_user and ac.status = 'accrued' and ac.payout_id is null;
  if v_available <= 0 then raise exception 'NO_AVAILABLE_COMMISSION'; end if;
  insert into affiliate_payouts (affiliate_id, amount, status)
    values (p_user, v_available, 'requested') returning id into v_payout;
  update affiliate_commissions ac set payout_id = v_payout
   where ac.affiliate_id = p_user and ac.status = 'accrued' and ac.payout_id is null;
  return query select v_payout, v_available;
end;
$fn$;

-- ── approve: admin authorizes B2C dispatch ──────────────────────────────────────────────────
-- requested -> approved; returns the amount + the affiliate's phone so the caller can fire the
-- B2C payment. Idempotent: a non-'requested' payout returns (false, null, null).
create or replace function public.fn_affiliate_approve_payout(p_payout uuid, p_admin uuid)
returns table(approved boolean, amount bigint, phone text)
language plpgsql security definer set search_path = public
as $fn$
declare v_aff uuid; v_amt bigint; v_status text; v_phone text;
begin
  select ap.affiliate_id, ap.amount, ap.status into v_aff, v_amt, v_status
    from affiliate_payouts ap where ap.id = p_payout for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v_status <> 'requested' then
    return query select false, null::bigint, null::text; return;
  end if;
  update affiliate_payouts set status = 'approved', approved_by = p_admin where id = p_payout;
  select pr.phone into v_phone from profiles pr where pr.id = v_aff;
  return query select true, v_amt, v_phone;
end;
$fn$;

-- ── complete: apply the B2C result (idempotent) ─────────────────────────────────────────────
-- Only meaningful for an 'approved' payout. result_code 0 => mark paid + move reserved buckets
-- accrued->paid; non-zero => reject + release the reservation (buckets stay accrued). Terminal
-- payouts no-op. The audit columns (conversation/receipt/result/raw) capture the B2C interaction.
create or replace function public.fn_affiliate_complete_payout(
  p_payout uuid, p_result_code int, p_conversation text, p_receipt text, p_desc text, p_raw jsonb
) returns table(applied boolean, status text)
language plpgsql security definer set search_path = public
as $fn$
declare v_status text;
begin
  select ap.status into v_status from affiliate_payouts ap where ap.id = p_payout for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v_status in ('paid', 'rejected') then           -- idempotent: terminal already
    return query select false, v_status; return;
  end if;
  if v_status <> 'approved' then                     -- a result is only valid after approval/dispatch
    return query select false, v_status; return;
  end if;
  if p_result_code = 0 then
    update affiliate_payouts ap
       set status = 'paid', paid_at = now(), conversation_id = p_conversation,
           mpesa_receipt = p_receipt, result_code = p_result_code, result_desc = p_desc, raw_callback = p_raw
     where ap.id = p_payout;
    update affiliate_commissions ac set status = 'paid'
     where ac.payout_id = p_payout and ac.status = 'accrued';
    return query select true, 'paid'; return;
  else
    update affiliate_payouts ap
       set status = 'rejected', conversation_id = p_conversation,
           result_code = p_result_code, result_desc = p_desc, raw_callback = p_raw
     where ap.id = p_payout;
    update affiliate_commissions ac set payout_id = null
     where ac.payout_id = p_payout and ac.status = 'accrued';
    return query select true, 'rejected'; return;
  end if;
end;
$fn$;

-- ── reject: admin declines a pre-dispatch request ───────────────────────────────────────────
-- requested -> rejected and releases the reservation. Idempotent: only a 'requested' payout
-- (never dispatched to B2C) can be rejected; anything else returns false.
create or replace function public.fn_affiliate_reject_payout(p_payout uuid, p_admin uuid)
returns boolean language plpgsql security definer set search_path = public
as $fn$
declare v_status text;
begin
  select ap.status into v_status from affiliate_payouts ap where ap.id = p_payout for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v_status <> 'requested' then return false; end if;
  update affiliate_payouts set status = 'rejected', approved_by = p_admin where id = p_payout;
  update affiliate_commissions set payout_id = null where payout_id = p_payout and status = 'accrued';
  return true;
end;
$fn$;

-- ── grants: service-role only ───────────────────────────────────────────────────────────────
do $g$
begin
  revoke all on function public.fn_affiliate_request_payout(uuid)                       from public;
  revoke all on function public.fn_affiliate_approve_payout(uuid,uuid)                  from public;
  revoke all on function public.fn_affiliate_complete_payout(uuid,int,text,text,text,jsonb) from public;
  revoke all on function public.fn_affiliate_reject_payout(uuid,uuid)                   from public;
  revoke all on function public.fn_affiliate_request_payout(uuid)                       from anon;
  revoke all on function public.fn_affiliate_approve_payout(uuid,uuid)                  from anon;
  revoke all on function public.fn_affiliate_complete_payout(uuid,int,text,text,text,jsonb) from anon;
  revoke all on function public.fn_affiliate_reject_payout(uuid,uuid)                   from anon;
  revoke all on function public.fn_affiliate_request_payout(uuid)                       from authenticated;
  revoke all on function public.fn_affiliate_approve_payout(uuid,uuid)                  from authenticated;
  revoke all on function public.fn_affiliate_complete_payout(uuid,int,text,text,text,jsonb) from authenticated;
  revoke all on function public.fn_affiliate_reject_payout(uuid,uuid)                   from authenticated;
  grant execute on function public.fn_affiliate_request_payout(uuid)                       to service_role;
  grant execute on function public.fn_affiliate_approve_payout(uuid,uuid)                  to service_role;
  grant execute on function public.fn_affiliate_complete_payout(uuid,int,text,text,text,jsonb) to service_role;
  grant execute on function public.fn_affiliate_reject_payout(uuid,uuid)                   to service_role;
end
$g$;

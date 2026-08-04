-- 0033_marketers.sql
-- Marketer payments module: "marketers" are special players who RECEIVE payments and can
-- withdraw their balance. Self-contained (separate from players/affiliates). Money is stored
-- as integer cents (KES). All balance mutations go through the atomic, row-locking RPCs below
-- and are recorded in an append-only ledger; withdrawals additionally create a withdrawal row.
--
-- Payout rail: INTERNAL ledger only (a withdrawal decrements the balance and is marked 'paid').
-- Wire a real M-PESA B2C rail later by setting method/status/reference on marketer_withdrawals.

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketer_wallets (
  marketer_id   uuid PRIMARY KEY REFERENCES public.marketers(id) ON DELETE CASCADE,
  balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency      text   NOT NULL DEFAULT 'KES',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketer_ledger (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  marketer_id         uuid NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  entry_type          text NOT NULL CHECK (entry_type IN ('credit','withdrawal','adjustment','reversal')),
  amount_cents        bigint NOT NULL,                 -- signed: +credit / -withdrawal
  balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
  ref                 text,                            -- optional idempotency / external key
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketer_ledger_ref_uk  ON public.marketer_ledger(ref) WHERE ref IS NOT NULL;
CREATE INDEX        IF NOT EXISTS marketer_ledger_mkt_idx ON public.marketer_ledger(marketer_id, id DESC);

CREATE TABLE IF NOT EXISTS public.marketer_withdrawals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id  uuid NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status       text NOT NULL DEFAULT 'paid' CHECK (status IN ('requested','paid','failed','reversed')),
  method       text NOT NULL DEFAULT 'internal',
  reference    text,
  ledger_id    bigint REFERENCES public.marketer_ledger(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);
CREATE INDEX IF NOT EXISTS marketer_withdrawals_mkt_idx ON public.marketer_withdrawals(marketer_id, created_at DESC);

-- ── RPCs ────────────────────────────────────────────────────────────────────
-- Register (or upsert-by-phone) a marketer and ensure a wallet exists.
CREATE OR REPLACE FUNCTION public.fn_marketer_create(p_name text, p_phone text)
RETURNS public.marketers
LANGUAGE plpgsql AS $func$
DECLARE m public.marketers;
BEGIN
  IF p_name  IS NULL OR length(btrim(p_name))  = 0 THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF p_phone IS NULL OR length(btrim(p_phone)) = 0 THEN RAISE EXCEPTION 'PHONE_REQUIRED'; END IF;
  INSERT INTO public.marketers(name, phone)
    VALUES (btrim(p_name), btrim(p_phone))
    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING * INTO m;
  INSERT INTO public.marketer_wallets(marketer_id) VALUES (m.id)
    ON CONFLICT (marketer_id) DO NOTHING;
  RETURN m;
END
$func$;

-- Credit (pay) a marketer. Idempotent when p_ref is supplied. Returns the new balance (cents).
CREATE OR REPLACE FUNCTION public.fn_marketer_credit(
  p_marketer_id uuid, p_amount_cents bigint, p_ref text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql AS $func$
DECLARE new_bal bigint; existing bigint;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;
  IF p_ref IS NOT NULL THEN
    SELECT balance_after_cents INTO existing FROM public.marketer_ledger WHERE ref = p_ref;
    IF FOUND THEN RETURN existing; END IF;
  END IF;
  SELECT balance_cents INTO new_bal FROM public.marketer_wallets WHERE marketer_id = p_marketer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  new_bal := new_bal + p_amount_cents;
  UPDATE public.marketer_wallets SET balance_cents = new_bal, updated_at = now() WHERE marketer_id = p_marketer_id;
  INSERT INTO public.marketer_ledger(marketer_id, entry_type, amount_cents, balance_after_cents, ref, meta)
    VALUES (p_marketer_id, 'credit', p_amount_cents, new_bal, p_ref, COALESCE(p_meta,'{}'::jsonb));
  RETURN new_bal;
END
$func$;

-- Withdraw from a marketer. Atomic + row-locked; blocks overdraw; idempotent when p_ref supplied.
-- Returns jsonb { idempotent, balance_cents, withdrawal_id?, ledger_id }.
CREATE OR REPLACE FUNCTION public.fn_marketer_withdraw(
  p_marketer_id uuid, p_amount_cents bigint, p_ref text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb, p_method text DEFAULT 'internal')
RETURNS jsonb
LANGUAGE plpgsql AS $func$
DECLARE cur bigint; new_bal bigint; wid uuid; lid bigint; mstatus text; ex public.marketer_ledger;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;
  IF p_ref IS NOT NULL THEN
    SELECT * INTO ex FROM public.marketer_ledger WHERE ref = p_ref;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', true, 'balance_cents', ex.balance_after_cents, 'ledger_id', ex.id);
    END IF;
  END IF;
  SELECT status INTO mstatus FROM public.marketers WHERE id = p_marketer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  IF mstatus <> 'active' THEN RAISE EXCEPTION 'MARKETER_NOT_ACTIVE:%', mstatus; END IF;
  SELECT balance_cents INTO cur FROM public.marketer_wallets WHERE marketer_id = p_marketer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  IF cur < p_amount_cents THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS: have %, need %', cur, p_amount_cents; END IF;
  new_bal := cur - p_amount_cents;
  UPDATE public.marketer_wallets SET balance_cents = new_bal, updated_at = now() WHERE marketer_id = p_marketer_id;
  INSERT INTO public.marketer_ledger(marketer_id, entry_type, amount_cents, balance_after_cents, ref, meta)
    VALUES (p_marketer_id, 'withdrawal', -p_amount_cents, new_bal, p_ref, COALESCE(p_meta,'{}'::jsonb))
    RETURNING id INTO lid;
  INSERT INTO public.marketer_withdrawals(marketer_id, amount_cents, status, method, reference, ledger_id, paid_at)
    VALUES (p_marketer_id, p_amount_cents, 'paid', p_method, p_ref, lid, now())
    RETURNING id INTO wid;
  RETURN jsonb_build_object('idempotent', false, 'balance_cents', new_bal, 'withdrawal_id', wid, 'ledger_id', lid);
END
$func$;

-- Current balance (cents), or NULL if the marketer/wallet does not exist.
CREATE OR REPLACE FUNCTION public.fn_marketer_balance(p_marketer_id uuid)
RETURNS bigint LANGUAGE sql STABLE AS $func$
  SELECT balance_cents FROM public.marketer_wallets WHERE marketer_id = p_marketer_id;
$func$;

-- Newest-first ledger statement for a marketer.
CREATE OR REPLACE FUNCTION public.fn_marketer_statement(p_marketer_id uuid, p_limit int DEFAULT 50)
RETURNS SETOF public.marketer_ledger LANGUAGE sql STABLE AS $func$
  SELECT * FROM public.marketer_ledger
  WHERE marketer_id = p_marketer_id
  ORDER BY id DESC
  LIMIT GREATEST(COALESCE(p_limit,50), 1);
$func$;

-- Optional demo seed (run manually; not applied by this migration):
--   SELECT public.fn_marketer_create('Peter','0722000001');
--   SELECT public.fn_marketer_credit(  (SELECT id FROM public.marketers WHERE phone='0722000001'), 500000, 'seed-credit-1');
--   SELECT public.fn_marketer_withdraw((SELECT id FROM public.marketers WHERE phone='0722000001'), 200000, 'seed-withdraw-1');

-- ── Profile fields: Available Fuliza + airtime (admin-editable, integer cents) ──────────────
ALTER TABLE public.marketer_wallets
  ADD COLUMN IF NOT EXISTS available_fuliza_cents bigint NOT NULL DEFAULT 0 CHECK (available_fuliza_cents >= 0);
ALTER TABLE public.marketer_wallets
  ADD COLUMN IF NOT EXISTS airtime_balance_cents  bigint NOT NULL DEFAULT 0 CHECK (airtime_balance_cents  >= 0);

-- Name helpers (kept in sync with the app's NameUtils):
--   fn_first_name('Peter Muchendu') -> 'Peter';  fn_initials('Peter Muchendu') -> 'PM'
CREATE OR REPLACE FUNCTION public.fn_first_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $func$
  SELECT (regexp_split_to_array(btrim(coalesce(p_name,'')), '\s+'))[1];
$func$;

CREATE OR REPLACE FUNCTION public.fn_initials(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $func$
  WITH w AS (SELECT regexp_split_to_array(btrim(coalesce(p_name,'')), '\s+') AS a)
  SELECT upper(
    CASE
      WHEN array_length(a,1) IS NULL OR a[1] = '' THEN ''
      WHEN array_length(a,1) = 1                  THEN left(a[1], 2)
      ELSE left(a[1],1) || left(a[array_length(a,1)],1)
    END
  ) FROM w;
$func$;

-- Admin setters for the per-marketer profile fields.
CREATE OR REPLACE FUNCTION public.fn_marketer_set_fuliza(p_marketer_id uuid, p_amount_cents bigint)
RETURNS bigint LANGUAGE plpgsql AS $func$
DECLARE v bigint;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_NONNEGATIVE'; END IF;
  UPDATE public.marketer_wallets SET available_fuliza_cents = p_amount_cents, updated_at = now()
    WHERE marketer_id = p_marketer_id RETURNING available_fuliza_cents INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  RETURN v;
END $func$;

CREATE OR REPLACE FUNCTION public.fn_marketer_set_airtime(p_marketer_id uuid, p_amount_cents bigint)
RETURNS bigint LANGUAGE plpgsql AS $func$
DECLARE v bigint;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_NONNEGATIVE'; END IF;
  UPDATE public.marketer_wallets SET airtime_balance_cents = p_amount_cents, updated_at = now()
    WHERE marketer_id = p_marketer_id RETURNING airtime_balance_cents INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  RETURN v;
END $func$;

-- One-call profile for the app header: name, derived first_name + initials, balances.
CREATE OR REPLACE VIEW public.marketer_profiles AS
SELECT
  m.id, m.name,
  public.fn_first_name(m.name) AS first_name,
  public.fn_initials(m.name)   AS initials,
  m.phone, m.status,
  w.balance_cents,
  w.available_fuliza_cents,
  w.airtime_balance_cents,
  w.currency,
  w.updated_at AS wallet_updated_at,
  m.created_at
FROM public.marketers m
JOIN public.marketer_wallets w ON w.marketer_id = m.id;

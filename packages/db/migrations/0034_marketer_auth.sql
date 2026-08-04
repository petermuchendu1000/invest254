-- 0034_marketer_auth.sql
-- Marketer self-service authentication (phone + PIN) for the mobile app, plus lifecycle control.
--
-- Design / real-life scenarios:
--  * AUTH: a marketer logs in with their phone + a 4-6 digit PIN. PINs are bcrypt-hashed
--    (pgcrypto). fn_marketer_login returns the marketer id on success or NULL on ANY failure
--    (unknown phone / no PIN / wrong PIN / locked / inactive) so callers can't enumerate accounts.
--    5 consecutive failures lock the account for 15 minutes. The API signs a marketer-role JWT
--    (same SUPABASE_JWT_SECRET as players) from the returned id.
--  * DEMOTION / SUSPENSION: fn_marketer_set_status(...,'disabled'|'suspended') blocks new logins
--    AND (via the API's live status re-check on every request) revokes an already-issued token
--    immediately. Wallet + ledger + PIN are preserved, so reactivating restores full access.
--  * PLAYER (non-marketer) INSTALLS THE APP: they have no marketers row, so login returns NULL
--    (generic 401) and the marketer-scoped API routes return 403 NOT_MARKETER. Balances are only
--    ever the caller's own (the API resolves the marketer from the token subject against this table).
--  * FIRST PIN: set by an admin at onboarding (fn_marketer_set_pin). There is no self-service
--    reset (account-takeover risk); the authenticated PIN change (fn_marketer_change_pin) requires
--    the current PIN.

CREATE TABLE IF NOT EXISTS public.marketer_credentials (
  marketer_id     uuid PRIMARY KEY REFERENCES public.marketers(id) ON DELETE CASCADE,
  pin_hash        text NOT NULL,
  failed_attempts int  NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Set / reset a PIN (admin onboarding or recovery). Clears any lockout.
CREATE OR REPLACE FUNCTION public.fn_marketer_set_pin(p_marketer_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql AS $func$
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4,6}$' THEN RAISE EXCEPTION 'INVALID_PIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketers WHERE id = p_marketer_id) THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  INSERT INTO public.marketer_credentials(marketer_id, pin_hash)
    VALUES (p_marketer_id, extensions.crypt(p_pin, extensions.gen_salt('bf')))
    ON CONFLICT (marketer_id) DO UPDATE
      SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = now();
  RETURN true;
END
$func$;

-- Verify phone + PIN. Returns the marketer id on success, NULL on any failure (no enumeration).
-- Locks for 15 minutes after 5 consecutive failures.
CREATE OR REPLACE FUNCTION public.fn_marketer_login(p_phone text, p_pin text)
RETURNS uuid
LANGUAGE plpgsql AS $func$
DECLARE m record; c record;
BEGIN
  SELECT id, status INTO m FROM public.marketers WHERE phone = btrim(coalesce(p_phone, ''));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.marketer_credentials WHERE marketer_id = m.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.locked_until IS NOT NULL AND c.locked_until > now() THEN RETURN NULL; END IF;
  IF m.status <> 'active' THEN RETURN NULL; END IF;
  IF c.pin_hash = extensions.crypt(coalesce(p_pin, ''), c.pin_hash) THEN
    UPDATE public.marketer_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE marketer_id = m.id;
    RETURN m.id;
  END IF;
  UPDATE public.marketer_credentials
    SET failed_attempts = c.failed_attempts + 1,
        locked_until = CASE WHEN c.failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
        updated_at = now()
    WHERE marketer_id = m.id;
  RETURN NULL;
END
$func$;

-- Authenticated PIN change (proves possession of the current PIN).
CREATE OR REPLACE FUNCTION public.fn_marketer_change_pin(p_marketer_id uuid, p_current_pin text, p_new_pin text)
RETURNS boolean
LANGUAGE plpgsql AS $func$
DECLARE c record;
BEGIN
  IF p_new_pin IS NULL OR p_new_pin !~ '^\d{4,6}$' THEN RAISE EXCEPTION 'INVALID_PIN'; END IF;
  SELECT * INTO c FROM public.marketer_credentials WHERE marketer_id = p_marketer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_PIN_SET'; END IF;
  IF c.pin_hash <> extensions.crypt(coalesce(p_current_pin, ''), c.pin_hash) THEN RAISE EXCEPTION 'INVALID_CREDENTIALS'; END IF;
  UPDATE public.marketer_credentials
    SET pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')), failed_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE marketer_id = p_marketer_id;
  RETURN true;
END
$func$;

-- Admin lifecycle: active | suspended | disabled  (suspended/disabled == demotion).
CREATE OR REPLACE FUNCTION public.fn_marketer_set_status(p_marketer_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql AS $func$
DECLARE v text;
BEGIN
  IF p_status NOT IN ('active','suspended','disabled') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE public.marketers SET status = p_status, updated_at = now() WHERE id = p_marketer_id RETURNING status INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKETER_NOT_FOUND'; END IF;
  RETURN v;
END
$func$;

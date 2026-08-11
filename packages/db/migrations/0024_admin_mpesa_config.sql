-- 0024_admin_mpesa_config.sql — Admin-managed M-Pesa (Daraja) configuration.
-- A single durable `mpesa_config` row (id = 1) lets a superadmin set the paybill/shortcode,
-- environment, callback URLs and B2C initiator from the back office instead of redeploying
-- env vars. Secrets (consumer key/secret, passkey, B2C security credential) are write-only:
-- the read RPC never returns them — only `has_*` booleans. The engine reads the raw row at
-- startup (service-role connection) and FALLS BACK to env vars for any empty field, so an
-- untouched config preserves the previous env-driven behaviour exactly (no regression).
--
-- Mirrors the 0021/0022/0023 admin pattern: SECURITY DEFINER, superadmin role guard, partial
-- COALESCE patch, immutable admin_actions audit row (with secrets masked). Idempotent.

-- ── mpesa_config: singleton M-Pesa credentials + endpoints ──────────────────────────────────
create table if not exists public.mpesa_config (
  id                       int primary key default 1 check (id = 1),
  environment              text not null default 'sandbox' check (environment in ('sandbox','production')),
  shortcode                text not null default '',
  consumer_key             text not null default '',
  consumer_secret          text not null default '',
  passkey                  text not null default '',
  stk_callback_url         text not null default '',
  b2c_initiator            text not null default '',
  b2c_security_credential  text not null default '',
  b2c_result_url           text not null default '',
  b2c_timeout_url          text not null default '',
  updated_by               uuid references public.profiles(id),
  updated_at               timestamptz not null default now()
);

-- Seed the singleton row (empty → engine falls back to env until configured).
insert into public.mpesa_config (id) values (1) on conflict (id) do nothing;

-- Keep updated_at fresh on edits.
drop trigger if exists trg_mpesa_config_updated on public.mpesa_config;
create trigger trg_mpesa_config_updated before update on public.mpesa_config
  for each row execute function public.set_updated_at();

-- Lock the table down: deny all non-service access. The engine uses the service role (bypasses
-- RLS); SECURITY DEFINER functions below are the only sanctioned read/write path otherwise.
alter table public.mpesa_config enable row level security;

-- ── fn_admin_get_mpesa_config: masked read (admin+) ─────────────────────────────────────────
-- Returns non-secret fields plus has_* booleans. Never returns raw secrets.
create or replace function public.fn_admin_get_mpesa_config(p_actor_role text)
 returns table(environment text, shortcode text, stk_callback_url text, b2c_initiator text,
               b2c_result_url text, b2c_timeout_url text,
               has_consumer_key boolean, has_consumer_secret boolean, has_passkey boolean,
               has_security_credential boolean, updated_by uuid, updated_at timestamptz)
 language plpgsql security definer set search_path to 'public'
as $fn$
begin
  if p_actor_role not in ('admin','superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  return query
    select m.environment, m.shortcode, m.stk_callback_url, m.b2c_initiator,
           m.b2c_result_url, m.b2c_timeout_url,
           (m.consumer_key <> '')            as has_consumer_key,
           (m.consumer_secret <> '')         as has_consumer_secret,
           (m.passkey <> '')                 as has_passkey,
           (m.b2c_security_credential <> '') as has_security_credential,
           m.updated_by, m.updated_at
      from public.mpesa_config m where m.id = 1;
end;
$fn$;

-- ── fn_admin_update_mpesa_config: superadmin partial edit ───────────────────────────────────
-- Plain fields are COALESCEd from the patch. Secret fields are updated ONLY when the patch
-- carries a non-empty value (so omitting/empty keeps the current secret). The audit row records
-- the plain-field diff and which secrets were rotated — never the secret values themselves.
create or replace function public.fn_admin_update_mpesa_config(p_actor uuid, p_actor_role text, p_patch jsonb)
 returns table(environment text, shortcode text, stk_callback_url text, b2c_initiator text,
               b2c_result_url text, b2c_timeout_url text,
               has_consumer_key boolean, has_consumer_secret boolean, has_passkey boolean,
               has_security_credential boolean, updated_by uuid, updated_at timestamptz)
 language plpgsql security definer set search_path to 'public'
as $fn$
declare v_before jsonb; v_after public.mpesa_config%rowtype;
begin
  if p_actor_role <> 'superadmin' then raise exception 'NOT_AUTHORIZED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  if (p_patch ? 'environment') and (p_patch->>'environment') not in ('sandbox','production') then
    raise exception 'INVALID_CONFIG';
  end if;
  select to_jsonb(m) into v_before from public.mpesa_config m where id = 1 for update;
  if v_before is null then raise exception 'NOT_FOUND'; end if;

  update public.mpesa_config set
    environment             = coalesce(p_patch->>'environment',    mpesa_config.environment),
    shortcode               = coalesce(p_patch->>'shortcode',      mpesa_config.shortcode),
    stk_callback_url        = coalesce(p_patch->>'stkCallbackUrl', mpesa_config.stk_callback_url),
    b2c_initiator           = coalesce(p_patch->>'b2cInitiator',   mpesa_config.b2c_initiator),
    b2c_result_url          = coalesce(p_patch->>'b2cResultUrl',   mpesa_config.b2c_result_url),
    b2c_timeout_url         = coalesce(p_patch->>'b2cTimeoutUrl',  mpesa_config.b2c_timeout_url),
    -- secrets: only overwrite when a non-empty value is supplied
    consumer_key            = case when coalesce(p_patch->>'consumerKey','') <> ''        then p_patch->>'consumerKey'        else mpesa_config.consumer_key end,
    consumer_secret         = case when coalesce(p_patch->>'consumerSecret','') <> ''     then p_patch->>'consumerSecret'     else mpesa_config.consumer_secret end,
    passkey                 = case when coalesce(p_patch->>'passkey','') <> ''            then p_patch->>'passkey'            else mpesa_config.passkey end,
    b2c_security_credential = case when coalesce(p_patch->>'securityCredential','') <> '' then p_patch->>'securityCredential' else mpesa_config.b2c_security_credential end,
    updated_by              = p_actor
  where id = 1
  returning * into v_after;

  insert into public.admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'mpesa.config', 'mpesa_config', '1',
            jsonb_build_object(
              'before', jsonb_build_object('environment', v_before->>'environment', 'shortcode', v_before->>'shortcode',
                                           'stkCallbackUrl', v_before->>'stk_callback_url', 'b2cInitiator', v_before->>'b2c_initiator',
                                           'b2cResultUrl', v_before->>'b2c_result_url', 'b2cTimeoutUrl', v_before->>'b2c_timeout_url'),
              'after',  jsonb_build_object('environment', v_after.environment, 'shortcode', v_after.shortcode,
                                           'stkCallbackUrl', v_after.stk_callback_url, 'b2cInitiator', v_after.b2c_initiator,
                                           'b2cResultUrl', v_after.b2c_result_url, 'b2cTimeoutUrl', v_after.b2c_timeout_url),
              'secretsRotated', jsonb_build_object(
                'consumerKey',        coalesce(p_patch->>'consumerKey','') <> '',
                'consumerSecret',     coalesce(p_patch->>'consumerSecret','') <> '',
                'passkey',            coalesce(p_patch->>'passkey','') <> '',
                'securityCredential', coalesce(p_patch->>'securityCredential','') <> '')));

  return query
    select v_after.environment, v_after.shortcode, v_after.stk_callback_url, v_after.b2c_initiator,
           v_after.b2c_result_url, v_after.b2c_timeout_url,
           (v_after.consumer_key <> ''),            (v_after.consumer_secret <> ''),
           (v_after.passkey <> ''),                 (v_after.b2c_security_credential <> ''),
           v_after.updated_by, v_after.updated_at;
end;
$fn$;

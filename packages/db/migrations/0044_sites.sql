-- 0044_sites.sql — Multi-tenant foundation: the `sites` (brand/tenant) registry.
--
-- This is the heart of the platform template. Every website ("brand"/"skin") is ONE row
-- here. All brand-diverse variables (name, logo, colours, domain, currency, licence copy,
-- per-brand M-Pesa + provably-fair seed lineage) live on this row, so launching a new site
-- is inserting a row + pointing a domain at the platform — never editing code.
--
-- Secrets (M-Pesa passkey, B2C security credential, master seed) are stored BY REFERENCE
-- (a key name resolved against the platform secret store / Fly secrets), never as plaintext,
-- mirroring the single-tenant HOSTING.md discipline.
--
-- Idempotent (safe to re-run), single-statement DO block, per the packages/db conventions.

do $$
begin
  -- ── enum-ish status via CHECK (kept simple, matches the repo style) ───────────────────
  create table if not exists public.sites (
    id                uuid primary key default gen_random_uuid(),
    slug              text unique not null,                 -- stable machine id, e.g. 'invest254'
    status            text not null default 'active'
                        check (status in ('active','paused','archived')),

    -- ── BRAND (what makes each site look/feel different) ────────────────────────────────
    name              text not null,                        -- display name / wordmark, e.g. 'Invest254'
    primary_domain    text unique,                          -- e.g. 'invest254.com' (host → site resolution)
    logo_url          text,
    favicon_url       text,
    color_primary     text not null default '#22c55e',      -- brand green
    color_bg          text not null default '#0a0a0a',
    color_accent      text not null default '#06b6d4',
    theme             text not null default 'dark' check (theme in ('dark','light','auto')),
    wordmark_text     text,                                 -- overrides `name` in the top bar if set
    currency          text not null default 'KES',
    locale            text not null default 'en-KE',
    licence_line      text,                                 -- footer legal line (per-brand licence)
    support_email     text,
    legal_copy        jsonb not null default '{}'::jsonb,   -- {terms, privacy, responsibleGaming, ...}

    -- ── MONEY (per-brand M-Pesa routing; secrets by reference) ──────────────────────────
    mpesa_env             text not null default 'sandbox' check (mpesa_env in ('sandbox','production')),
    mpesa_shortcode       text,
    mpesa_consumer_key_ref text,                            -- secret-store key name, not the value
    mpesa_consumer_secret_ref text,
    mpesa_passkey_ref     text,
    mpesa_b2c_initiator   text,
    mpesa_b2c_credential_ref text,
    mpesa_callback_base   text,                             -- e.g. https://api.platform.../s/<slug>

    -- ── FAIRNESS (each brand has its own daily seed lineage) ────────────────────────────
    master_seed_ref   text,                                 -- secret-store key holding this brand's MASTER_SEED

    -- ── OWNERSHIP / OPS ─────────────────────────────────────────────────────────────────
    owner_user_id     uuid,                                 -- the site_superadmin (profiles.id), set post-bootstrap
    notes             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );

  create index if not exists idx_sites_status on public.sites(status);

  -- keep updated_at fresh (0001 helper)
  drop trigger if exists trg_sites_updated_at on public.sites;
  create trigger trg_sites_updated_at before update on public.sites
    for each row execute function public.set_updated_at();

  -- ── Seed the DEFAULT site (the current Invest254 brand becomes site #1) ───────────────
  -- Fixed UUID so backfills in 0045 and app bootstrap can reference it deterministically.
  insert into public.sites (id, slug, name, primary_domain, currency, licence_line, mpesa_env)
  values ('00000000-0000-0000-0000-000000000001', 'invest254', 'Invest254',
          'invest254.com', 'KES',
          'Invest254 operates under licence — replace with the actual issued licence.', 'production')
  on conflict (id) do nothing;
end $$;

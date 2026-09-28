-- 0171_user_display_currency.sql — #10 geo-currency: a per-USER display-currency preference.
--
-- The money of record stays integer KES cents (wallet, ledger, bets, M-Pesa). This is a presentation
-- choice ONLY: when set, the web renders KES amounts in this currency at the live FX rate (fx.ts),
-- overriding both the geo-detected default and the brand's own `sites.currency`. NULL means "no
-- explicit choice" → fall back to geo-detection, then the brand currency (see resolveDisplayCurrency).
--
-- Nothing here moves money. The column is nullable and additive, so the change is inert until the API
-- writes it. Only the service_role (the API) reads/writes it — the exact supported-currency set is
-- enforced in the API layer (isSupportedDisplayCurrency) to avoid DB/code drift; the DB keeps only a
-- cheap shape guard (a 3-letter upper-case ISO-4217 code, or NULL).
begin;

alter table public.profiles
  add column if not exists display_currency text
    check (display_currency is null or display_currency ~ '^[A-Z]{3}$');

comment on column public.profiles.display_currency is
  'Per-user display currency (#10). Presentation only; money of record is KES cents. NULL = use geo/brand default.';

commit;

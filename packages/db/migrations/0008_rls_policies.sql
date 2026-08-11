do $mig$
begin
  -- 1) Enable RLS on every public table
  alter table public.profiles               enable row level security;
  alter table public.wallets                enable row level security;
  alter table public.ledger_entries         enable row level security;
  alter table public.game_config            enable row level security;
  alter table public.game_days              enable row level security;
  alter table public.positions              enable row level security;
  alter table public.transactions           enable row level security;
  alter table public.affiliates             enable row level security;
  alter table public.referrals              enable row level security;
  alter table public.affiliate_commissions  enable row level security;
  alter table public.affiliate_payouts      enable row level security;
  alter table public.activity_feed          enable row level security;
  alter table public.chat_messages          enable row level security;
  alter table public.bonuses                enable row level security;
  alter table public.promo_codes            enable row level security;
  alter table public.audit_log              enable row level security;

  -- 2) Owner-only / self-access SELECT policies (authenticated reads own rows)
  drop policy if exists sel_own on public.profiles;
  create policy sel_own on public.profiles for select to authenticated using (auth.uid() = id);

  drop policy if exists sel_own on public.wallets;
  create policy sel_own on public.wallets for select to authenticated using (auth.uid() = user_id);

  drop policy if exists sel_own on public.ledger_entries;
  create policy sel_own on public.ledger_entries for select to authenticated using (auth.uid() = user_id);

  drop policy if exists sel_own on public.positions;
  create policy sel_own on public.positions for select to authenticated using (auth.uid() = user_id);

  drop policy if exists sel_own on public.transactions;
  create policy sel_own on public.transactions for select to authenticated using (auth.uid() = user_id);

  drop policy if exists sel_own on public.bonuses;
  create policy sel_own on public.bonuses for select to authenticated using (auth.uid() = user_id);

  drop policy if exists sel_own on public.affiliates;
  create policy sel_own on public.affiliates for select to authenticated using (auth.uid() = user_id);

  drop policy if exists sel_own on public.referrals;
  create policy sel_own on public.referrals for select to authenticated using (auth.uid() = affiliate_id);

  drop policy if exists sel_own on public.affiliate_commissions;
  create policy sel_own on public.affiliate_commissions for select to authenticated using (auth.uid() = affiliate_id);

  drop policy if exists sel_own on public.affiliate_payouts;
  create policy sel_own on public.affiliate_payouts for select to authenticated using (auth.uid() = affiliate_id);

  -- 3) Public-read tables (fairness + social proof)
  drop policy if exists sel_public on public.game_days;
  create policy sel_public on public.game_days for select to anon, authenticated using (true);

  drop policy if exists sel_public on public.activity_feed;
  create policy sel_public on public.activity_feed for select to anon, authenticated using (true);

  -- 4) Chat: public read of visible messages; authenticated may post as themselves
  drop policy if exists sel_visible on public.chat_messages;
  create policy sel_visible on public.chat_messages for select to anon, authenticated using (is_hidden = false);

  drop policy if exists ins_own on public.chat_messages;
  create policy ins_own on public.chat_messages for insert to authenticated with check (auth.uid() = user_id);

  -- 5) game_config, promo_codes, audit_log: RLS enabled with NO policy =>
  --    accessible only to the service role (BYPASSRLS) / table owner. Intentional.
end
$mig$;


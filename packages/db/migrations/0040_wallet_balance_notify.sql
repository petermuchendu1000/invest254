-- 0040_wallet_balance_notify.sql
-- Real-time wallet balance push.
--
-- Problem this fixes: the on-screen balance only refreshed in real-time for engine-driven
-- events (auth / open_position / position_settled), because those are the only points where
-- the WebSocket engine reads the wallet and pushes a `balance` frame. Every OTHER balance
-- mutation happens in a Postgres RPC invoked by the REST API (M-Pesa deposit confirmation,
-- withdrawal hold/settle/refund, admin manual credit/debit, deposit-bonus credit, bonus
-- conversion). The engine never learned about those, so a connected browser kept showing a
-- stale balance until a full reload.
--
-- Fix (mirrors migration 0028's `game_config_changed` design): every balance-changing RPC
-- already does `UPDATE wallets SET real_balance/bonus_balance ...`, so a single AFTER trigger
-- on `wallets` catches ALL of them. It emits `pg_notify('wallet_changed', <user_id>)`; the
-- engine LISTENs on that channel and pushes a fresh `balance` frame to that user's sockets.
--
-- Idempotent + additive: safe to re-run; changes no existing data, columns, or RPCs.

create or replace function fn_notify_wallet_changed() returns trigger
language plpgsql as $$
begin
  -- INSERT (wallet created), or a real change to either balance. `is distinct from` treats
  -- NULLs correctly and skips no-op writes (e.g. an updated_at-only touch) so we don't spam.
  if tg_op = 'INSERT'
     or new.real_balance  is distinct from old.real_balance
     or new.bonus_balance is distinct from old.bonus_balance then
    perform pg_notify('wallet_changed', new.user_id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wallet_changed on wallets;
create trigger trg_wallet_changed
  after insert or update on wallets
  for each row execute function fn_notify_wallet_changed();

-- 0039_drop_activity_chat.sql — Remove the live activity feed and player chat entirely.
--
-- WHY: product decision to remove the social-proof feed and chat (previously seeded with
-- simulated content). The engine/API no longer read or write these tables (same PR), so
-- dropping them is the final cleanup. Real player data (wallets, positions, transactions)
-- is untouched.
--
-- Idempotent: IF EXISTS guards make re-applying a no-op.

drop table if exists public.activity_feed;
drop table if exists public.chat_messages;

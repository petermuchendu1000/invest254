-- 0038_min_stake_250.sql — Raise the minimum stake to KES 250 (25,000 cents).
--
-- WHY: product decision to lift the floor from KES 100 -> KES 250. The engine reads
-- game_config.min_stake at runtime (0028 made it the source of truth) and fn_open_position
-- re-checks it as the last gate before money moves, so changing the row is sufficient for the
-- backend; the shared DEFAULT_CONFIG fallback and the web presets are updated in the same PR.
--
-- Idempotent: the WHERE guard means re-applying is a no-op (and does not needlessly bump the
-- config version / snapshot via the 0028 triggers). Feasibility is unchanged (min_stake is not
-- part of the RTP CHECK) and 25,000 <= max_stake, so the chk constraints still hold.

update public.game_config
   set min_stake = 25000
 where id = 1
   and min_stake < 25000;

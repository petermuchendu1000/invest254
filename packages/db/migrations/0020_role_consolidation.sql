-- 0020 role-model consolidation: collapse to player < marketer < admin < superadmin.
-- The product uses two staff tiers — `admin` (day-to-day operations) and `superadmin` (full
-- control) — plus `player` and `marketer` (a marketer is also a player). This drops the unused
-- support / finance_admin / super_admin granularity. Any legacy rows are remapped defensively
-- BEFORE the new CHECK is installed, so the migration is safe against historical data and
-- idempotent (re-running is a no-op once roles are already in the new set).
do $mig$
begin
  -- 1) drop the old constraint so the remap UPDATE can't transiently violate it
  alter table public.profiles drop constraint if exists profiles_role_check;
  -- 2) remap legacy tiers to the new model
  update public.profiles set role = 'admin'      where role in ('support', 'finance_admin');
  update public.profiles set role = 'superadmin' where role = 'super_admin';
  -- 3) install the final constraint (player is still the column default)
  alter table public.profiles
    add constraint profiles_role_check check (role in ('player', 'marketer', 'admin', 'superadmin'));
end
$mig$;

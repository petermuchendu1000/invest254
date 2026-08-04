-- 0031_user_notifications.sql — Per-user sticky notifications (admin/system → player).
--
-- A notification is either DISMISSIBLE (the player clears it with the X → dismissed_at) or
-- BLOCKING (dismissible=false, e.g. account suspension and other activity-limiting states —
-- the player cannot clear it; it stays until an admin/system RESOLVES it → resolved_at, e.g.
-- when the account is reactivated). "Active" = dismissed_at IS NULL AND resolved_at IS NULL.
--
-- Written by the engine/API as the service role (RLS-bypassing). RLS is still enabled with a
-- self-select policy as defense-in-depth in case the row is ever read via anon/authenticated.
--
-- Idempotent: safe to re-apply.

create table if not exists public.user_notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  level        text        not null default 'info' check (level in ('info','success','warning','error')),
  title        text        not null check (length(title) between 1 and 120),
  body         text        not null default '' check (length(body) <= 1000),
  dismissible  boolean     not null default true,
  category     text,                              -- machine tag, e.g. 'account_suspended','system','bonus'
  created_by   uuid,                              -- admin actor; null = system
  created_at   timestamptz not null default now(),
  dismissed_at timestamptz,                       -- set when the player dismisses a dismissible one
  resolved_at  timestamptz                        -- set when an admin/system clears it (esp. blocking)
);

-- Hot path: a player's active banners, newest first.
create index if not exists idx_user_notifications_active
  on public.user_notifications (user_id, created_at desc)
  where dismissed_at is null and resolved_at is null;

-- Resolve-by-category lookups (e.g. clear 'account_suspended' on reactivate).
create index if not exists idx_user_notifications_user_category
  on public.user_notifications (user_id, category)
  where resolved_at is null;

alter table public.user_notifications enable row level security;

-- Defense-in-depth: a player may read only their own rows. All mutations go through the
-- service role (API), so no insert/update policy is granted to anon/authenticated.
drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own on public.user_notifications
  for select using (auth.uid() = user_id);

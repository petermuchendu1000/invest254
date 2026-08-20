-- 0097_marketer_set_site.sql
-- Task 1(a) — assign / move a marketer to a specific site (brand).
--
-- fn_marketer_update (0083) edits name/phone only. Moving a marketer between brands must respect the
-- per-(site, phone) uniqueness that scopes marketer identity, so this dedicated RPC: locks the row,
-- validates the destination site exists, enforces phone-uniqueness on the DESTINATION brand, then
-- reassigns site_id. A same-site call is a no-op. Mirrors fn_marketer_update's shape (returns the
-- marketer row); the API layer enforces caller scope + audits.

create or replace function public.fn_marketer_set_site(p_marketer_id uuid, p_site_id uuid)
returns public.marketers
language plpgsql security definer set search_path = public
as $fn$
declare m public.marketers;
begin
  select * into m from public.marketers where id = p_marketer_id for update;
  if not found then raise exception 'MARKETER_NOT_FOUND'; end if;

  if not exists (select 1 from public.sites s where s.id = p_site_id) then raise exception 'SITE_NOT_FOUND'; end if;

  -- Same brand -> nothing to do.
  if m.site_id = p_site_id then return m; end if;

  -- The marketer's phone must be free on the destination brand (identity is per (site, phone)).
  if exists (
    select 1 from public.marketers x
     where x.site_id = p_site_id and x.phone = m.phone and x.id <> p_marketer_id
  ) then
    raise exception 'PHONE_TAKEN';
  end if;

  update public.marketers
     set site_id = p_site_id, updated_at = now()
   where id = p_marketer_id
   returning * into m;
  return m;
end;
$fn$;

revoke all on function public.fn_marketer_set_site(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fn_marketer_set_site(uuid,uuid) to service_role;

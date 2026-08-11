-- 0001 helpers: shared updated_at trigger function (idempotent)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;


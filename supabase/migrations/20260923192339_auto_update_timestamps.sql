create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  return new;
end;
$$;

revoke all on function private.set_updated_at()
from public, anon, authenticated;


create trigger appointments_set_updated_at
  before update on public.appointments
  for each row
  execute function private.set_updated_at();


create trigger clinic_ads_set_updated_at
  before update on public.clinic_ads
  for each row
  execute function private.set_updated_at();
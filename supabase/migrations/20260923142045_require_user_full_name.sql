create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_full_name text;
begin
  user_full_name :=
    trim(new.raw_user_meta_data ->> 'full_name');

  if user_full_name is null or user_full_name = '' then
    raise exception 'Full name is required'
      using errcode = '23514';
  end if;

  insert into public.profiles (id, full_name)
  values (
    new.id,
    user_full_name
  );

  return new;
end;
$$;
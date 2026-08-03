begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.handle_new_shimadzu_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, approval_status, is_admin)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'pending', false)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.claim_first_shimadzu_admin(bootstrap_code text)
returns public.profiles
language plpgsql
security definer
set search_path = public, extensions
as $$
declare result public.profiles;
begin
  perform pg_advisory_xact_lock(hashtext('shimadzu-admin-bootstrap'));
  if exists(select 1 from public.profiles where is_admin) then
    raise exception 'administrator already initialized';
  end if;
  if encode(digest(coalesce(bootstrap_code, ''), 'sha256'), 'hex') <> '36b0898b4d5967d98d802d07d3afa24ede640f83e109aba0d3ac19eebbd8390c' then
    raise exception 'invalid administrator initialization code';
  end if;
  update public.profiles
  set approval_status = 'approved', is_admin = true, reviewed_at = now(), reviewed_by = auth.uid()
  where id = auth.uid()
  returning * into result;
  if result.id is null then raise exception 'profile not found'; end if;
  return result;
end;
$$;

revoke all on function public.claim_first_shimadzu_admin(text) from public;
grant execute on function public.claim_first_shimadzu_admin(text) to authenticated;

commit;

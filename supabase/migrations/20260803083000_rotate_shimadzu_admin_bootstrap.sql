begin;

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
  if encode(digest(coalesce(bootstrap_code, ''), 'sha256'), 'hex') <> 'f9a6c15c0dbd53e1ab5a4dd1c99baeaca4452065eafd9da430599e031e2c1962' then
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

commit;

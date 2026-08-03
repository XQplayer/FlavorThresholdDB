begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected', 'suspended')),
  is_admin boolean not null default false,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create table if not exists public.shimadzu_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status text not null check (status in ('created', 'running', 'waiting_review', 'complete', 'failed', 'cancelled', 'expired')),
  mode text not null default 'continuous' check (mode in ('continuous', 'step')),
  current_stage integer not null default 0 check (current_stage between 0 and 7),
  progress integer not null default 0 check (progress between 0 and 100),
  source_names jsonb not null default '{}'::jsonb,
  stage_summary jsonb not null default '[]'::jsonb,
  qc_summary jsonb not null default '{}'::jsonb,
  result_path text,
  result_sha256 text,
  result_size bigint check (result_size is null or result_size between 0 and 52428800),
  result_expires_at timestamptz not null default (now() + interval '7 days'),
  record_expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.shimadzu_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.shimadzu_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage integer check (stage is null or stage between 0 and 6),
  event_type text not null,
  message text not null default '' check (char_length(message) <= 1000),
  severity text not null default 'PASS' check (severity in ('PASS', 'WARN', 'REVIEW', 'FAIL')),
  created_at timestamptz not null default now()
);

create index if not exists shimadzu_jobs_user_created_idx on public.shimadzu_jobs(user_id, created_at desc);
create index if not exists shimadzu_jobs_result_expiry_idx on public.shimadzu_jobs(result_expires_at) where result_path is not null;
create index if not exists shimadzu_jobs_record_expiry_idx on public.shimadzu_jobs(record_expires_at);
create index if not exists shimadzu_job_events_job_idx on public.shimadzu_job_events(job_id, created_at);

create or replace function public.is_shimadzu_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.handle_new_shimadzu_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare first_account boolean;
begin
  perform pg_advisory_xact_lock(hashtext('shimadzu-first-admin'));
  select not exists(select 1 from public.profiles) into first_account;
  insert into public.profiles(id, display_name, approval_status, is_admin, reviewed_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    case when first_account then 'approved' else 'pending' end,
    first_account,
    case when first_account then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_shimadzu on auth.users;
create trigger on_auth_user_created_shimadzu
after insert on auth.users for each row execute function public.handle_new_shimadzu_user();

create or replace function public.touch_shimadzu_job()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists touch_shimadzu_job on public.shimadzu_jobs;
create trigger touch_shimadzu_job before update on public.shimadzu_jobs
for each row execute function public.touch_shimadzu_job();

create or replace function public.review_shimadzu_user(target_user_id uuid, target_status text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare result public.profiles;
begin
  if not public.is_shimadzu_admin() then raise exception 'administrator approval required'; end if;
  if target_status not in ('approved', 'rejected', 'suspended') then raise exception 'invalid approval status'; end if;
  update public.profiles set approval_status = target_status, reviewed_at = now(), reviewed_by = auth.uid()
  where id = target_user_id returning * into result;
  return result;
end;
$$;

create or replace function public.cleanup_expired_shimadzu_data()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare removed_results integer := 0; removed_jobs integer := 0;
begin
  delete from storage.objects
  where bucket_id = 'shimadzu-results'
    and name in (select result_path from public.shimadzu_jobs where result_path is not null and result_expires_at <= now());
  get diagnostics removed_results = row_count;
  update public.shimadzu_jobs set result_path = null, result_sha256 = null, result_size = null, status = case when status = 'complete' then 'expired' else status end
  where result_path is not null and result_expires_at <= now();
  delete from public.shimadzu_jobs where record_expires_at <= now();
  get diagnostics removed_jobs = row_count;
  return jsonb_build_object('removed_results', removed_results, 'removed_jobs', removed_jobs);
end;
$$;

alter table public.profiles enable row level security;
alter table public.shimadzu_jobs enable row level security;
alter table public.shimadzu_job_events enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles for select to authenticated
using (id = auth.uid() or public.is_shimadzu_admin());

drop policy if exists jobs_select_self_or_admin on public.shimadzu_jobs;
create policy jobs_select_self_or_admin on public.shimadzu_jobs for select to authenticated
using (user_id = auth.uid() or public.is_shimadzu_admin());
drop policy if exists jobs_insert_approved_self on public.shimadzu_jobs;
create policy jobs_insert_approved_self on public.shimadzu_jobs for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved'));
drop policy if exists jobs_update_approved_self on public.shimadzu_jobs;
create policy jobs_update_approved_self on public.shimadzu_jobs for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved'));

drop policy if exists events_select_self_or_admin on public.shimadzu_job_events;
create policy events_select_self_or_admin on public.shimadzu_job_events for select to authenticated
using (user_id = auth.uid() or public.is_shimadzu_admin());
drop policy if exists events_insert_approved_self on public.shimadzu_job_events;
create policy events_insert_approved_self on public.shimadzu_job_events for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved'));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('shimadzu-results', 'shimadzu-results', false, 52428800, array['application/zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists shimadzu_results_select_owner on storage.objects;
create policy shimadzu_results_select_owner on storage.objects for select to authenticated
using (bucket_id = 'shimadzu-results' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists shimadzu_results_insert_owner on storage.objects;
create policy shimadzu_results_insert_owner on storage.objects for insert to authenticated
with check (bucket_id = 'shimadzu-results' and (storage.foldername(name))[1] = auth.uid()::text and exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved'));
drop policy if exists shimadzu_results_update_owner on storage.objects;
create policy shimadzu_results_update_owner on storage.objects for update to authenticated
using (bucket_id = 'shimadzu-results' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'shimadzu-results' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists shimadzu_results_delete_owner on storage.objects;
create policy shimadzu_results_delete_owner on storage.objects for delete to authenticated
using (bucket_id = 'shimadzu-results' and (storage.foldername(name))[1] = auth.uid()::text);

revoke all on public.profiles, public.shimadzu_jobs, public.shimadzu_job_events from anon;
grant select on public.profiles to authenticated;
grant select, insert, update on public.shimadzu_jobs to authenticated;
grant select, insert on public.shimadzu_job_events to authenticated;
grant usage, select on sequence public.shimadzu_job_events_id_seq to authenticated;
grant execute on function public.is_shimadzu_admin() to authenticated;
grant execute on function public.review_shimadzu_user(uuid, text) to authenticated;
grant execute on function public.cleanup_expired_shimadzu_data() to authenticated;

commit;

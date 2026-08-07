begin;

alter table public.shimadzu_jobs
  add column if not exists raw_path text,
  add column if not exists sample_path text,
  add column if not exists input_expires_at timestamptz not null default (now() + interval '90 days');

create index if not exists shimadzu_jobs_input_expiry_idx on public.shimadzu_jobs(input_expires_at)
  where raw_path is not null or sample_path is not null;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('shimadzu-inputs', 'shimadzu-inputs', false, 52428800, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists shimadzu_inputs_select_owner_or_admin on storage.objects;
create policy shimadzu_inputs_select_owner_or_admin on storage.objects for select to authenticated
using (bucket_id = 'shimadzu-inputs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_shimadzu_admin()));
drop policy if exists shimadzu_inputs_insert_owner on storage.objects;
create policy shimadzu_inputs_insert_owner on storage.objects for insert to authenticated
with check (bucket_id = 'shimadzu-inputs' and (storage.foldername(name))[1] = auth.uid()::text and exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved'));
drop policy if exists shimadzu_inputs_update_owner on storage.objects;
create policy shimadzu_inputs_update_owner on storage.objects for update to authenticated
using (bucket_id = 'shimadzu-inputs' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'shimadzu-inputs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists shimadzu_inputs_delete_owner_or_admin on storage.objects;
create policy shimadzu_inputs_delete_owner_or_admin on storage.objects for delete to authenticated
using (bucket_id = 'shimadzu-inputs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_shimadzu_admin()));

drop policy if exists shimadzu_results_select_owner on storage.objects;
create policy shimadzu_results_select_owner on storage.objects for select to authenticated
using (bucket_id = 'shimadzu-results' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_shimadzu_admin()));
drop policy if exists shimadzu_results_delete_owner on storage.objects;
create policy shimadzu_results_delete_owner on storage.objects for delete to authenticated
using (bucket_id = 'shimadzu-results' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_shimadzu_admin()));

drop policy if exists jobs_update_approved_self on public.shimadzu_jobs;
create policy jobs_update_approved_self_or_admin on public.shimadzu_jobs for update to authenticated
using (user_id = auth.uid() or public.is_shimadzu_admin())
with check ((user_id = auth.uid() and exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved')) or public.is_shimadzu_admin());

create or replace function public.cleanup_expired_shimadzu_data()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare removed_results integer := 0; removed_inputs integer := 0; removed_jobs integer := 0;
begin
  delete from storage.objects
  where bucket_id = 'shimadzu-results'
    and name in (select result_path from public.shimadzu_jobs where result_path is not null and result_expires_at <= now());
  get diagnostics removed_results = row_count;
  update public.shimadzu_jobs set result_path = null, result_sha256 = null, result_size = null, status = case when status = 'complete' then 'expired' else status end
  where result_path is not null and result_expires_at <= now();
  delete from storage.objects
  where bucket_id = 'shimadzu-inputs'
    and name in (select raw_path from public.shimadzu_jobs where raw_path is not null and input_expires_at <= now()
                 union all select sample_path from public.shimadzu_jobs where sample_path is not null and input_expires_at <= now());
  get diagnostics removed_inputs = row_count;
  update public.shimadzu_jobs set raw_path = null, sample_path = null
  where input_expires_at <= now() and (raw_path is not null or sample_path is not null);
  delete from public.shimadzu_jobs where record_expires_at <= now();
  get diagnostics removed_jobs = row_count;
  return jsonb_build_object('removed_results', removed_results, 'removed_inputs', removed_inputs, 'removed_jobs', removed_jobs);
end;
$$;

commit;

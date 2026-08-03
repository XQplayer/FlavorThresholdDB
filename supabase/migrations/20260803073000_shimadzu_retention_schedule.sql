begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

revoke execute on function public.cleanup_expired_shimadzu_data() from authenticated;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'shimadzu-retention-cleanup-daily';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

select cron.schedule(
  'shimadzu-retention-cleanup-daily',
  '17 3 * * *',
  $$
    select net.http_post(
      url := 'https://nwcoyhavzbygyqeadcnw.supabase.co/functions/v1/shimadzu-retention-cleanup',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

commit;

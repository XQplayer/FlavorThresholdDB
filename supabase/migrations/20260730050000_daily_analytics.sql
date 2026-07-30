create table if not exists public.daily_search_stats (
  stat_date date not null default current_date,
  cas text not null references public.search_stats(cas) on delete cascade,
  search_count bigint not null default 0 check (search_count >= 0),
  primary key (stat_date, cas)
);

create table if not exists public.site_daily_stats (
  stat_date date primary key default current_date,
  visit_count bigint not null default 0 check (visit_count >= 0)
);

alter table public.daily_search_stats enable row level security;
alter table public.site_daily_stats enable row level security;

drop policy if exists "Public can read daily search statistics" on public.daily_search_stats;
create policy "Public can read daily search statistics"
on public.daily_search_stats for select to anon, authenticated using (true);

drop policy if exists "Public can read site statistics" on public.site_daily_stats;
create policy "Public can read site statistics"
on public.site_daily_stats for select to anon, authenticated using (true);

create or replace function public.increment_search(
  p_cas text,
  p_common_name text,
  p_chinese_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_cas text := btrim(p_cas);
begin
  if normalized_cas is null or normalized_cas = '' or p_common_name is null or btrim(p_common_name) = '' then
    return;
  end if;

  insert into public.search_stats (cas, common_name, chinese_name, search_count, last_searched_at)
  values (normalized_cas, btrim(p_common_name), nullif(btrim(p_chinese_name), ''), 1, now())
  on conflict (cas) do update set
    common_name = excluded.common_name,
    chinese_name = coalesce(excluded.chinese_name, search_stats.chinese_name),
    search_count = search_stats.search_count + 1,
    last_searched_at = now();

  insert into public.daily_search_stats (stat_date, cas, search_count)
  values (current_date, normalized_cas, 1)
  on conflict (stat_date, cas) do update set
    search_count = daily_search_stats.search_count + 1;
end;
$$;

create or replace function public.increment_visit()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.site_daily_stats (stat_date, visit_count)
  values (current_date, 1)
  on conflict (stat_date) do update set
    visit_count = site_daily_stats.visit_count + 1;
$$;

create or replace function public.get_analytics_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_visits', coalesce((select sum(visit_count) from public.site_daily_stats), 0),
    'total_searches', coalesce((select sum(search_count) from public.search_stats), 0),
    'today_searches', coalesce((select sum(search_count) from public.daily_search_stats where stat_date = current_date), 0)
  );
$$;

revoke all on function public.increment_visit() from public;
grant execute on function public.increment_visit() to anon, authenticated;
revoke all on function public.get_analytics_summary() from public;
grant execute on function public.get_analytics_summary() to anon, authenticated;
grant select on public.daily_search_stats, public.site_daily_stats to anon, authenticated;

create table if not exists public.search_stats (
  cas text primary key,
  common_name text not null,
  chinese_name text,
  search_count bigint not null default 0 check (search_count >= 0),
  last_searched_at timestamptz not null default now()
);

alter table public.search_stats enable row level security;

drop policy if exists "Public can read search statistics" on public.search_stats;
create policy "Public can read search statistics"
on public.search_stats
for select
to anon, authenticated
using (true);

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
begin
  if p_cas is null or btrim(p_cas) = '' or p_common_name is null or btrim(p_common_name) = '' then
    return;
  end if;

  insert into public.search_stats (
    cas,
    common_name,
    chinese_name,
    search_count,
    last_searched_at
  )
  values (
    btrim(p_cas),
    btrim(p_common_name),
    nullif(btrim(p_chinese_name), ''),
    1,
    now()
  )
  on conflict (cas)
  do update set
    common_name = excluded.common_name,
    chinese_name = coalesce(excluded.chinese_name, search_stats.chinese_name),
    search_count = search_stats.search_count + 1,
    last_searched_at = now();
end;
$$;

revoke all on function public.increment_search(text, text, text) from public;
grant execute on function public.increment_search(text, text, text) to anon, authenticated;

grant select on table public.search_stats to anon, authenticated;

-- Replace Google/anon auth with a name+PIN model.
-- Players claim a name with a 4-digit PIN. The RPC returns a uuid token
-- that becomes their player_id for all rounds. Knowing someone's NAME
-- doesn't let you post under them — you need the PIN to mint a token.

create extension if not exists "pgcrypto";

drop view if exists public.leaderboard_entries;
drop table if exists public.round_results cascade;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name_ci text not null unique,
  name text not null,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint players_name_len check (char_length(name) between 2 and 20)
);

create table public.round_results (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  player_name text not null,
  score int not null check (score between 0 and 100),
  points_awarded int not null check (points_awarded >= 0),
  detection_rate double precision not null check (
    detection_rate between 0 and 1
  ),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint round_results_player_name_len check (
    char_length(player_name) between 1 and 60
  )
);

create index round_results_player_id_idx on public.round_results (player_id);
create index round_results_created_at_idx on public.round_results (created_at desc);

alter table public.players enable row level security;
alter table public.round_results enable row level security;

-- players: no policies on purpose. The pin_hash column must never be reachable
-- by clients; all access funnels through claim_or_login.

create policy "round_results_select_all"
  on public.round_results for select
  to anon, authenticated
  using (true);

create policy "round_results_insert_any"
  on public.round_results for insert
  to anon, authenticated
  with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert on public.round_results to anon, authenticated;

create or replace view public.leaderboard_entries
with (security_invoker = true) as
select
  r.player_id::text as player_id,
  p.name as player_name,
  sum(r.points_awarded)::bigint as total_points,
  max(r.score)::int as best_score,
  count(*)::int as rounds,
  min(r.created_at) as earliest_achieved_at
from public.round_results r
join public.players p on p.id = r.player_id
group by r.player_id, p.name;

grant select on public.leaderboard_entries to anon, authenticated;

-- The only door for minting a player_id. Claims a free name or verifies
-- the PIN against an existing one. pgcrypto lives in the `extensions`
-- schema on Supabase, so we add it to the search_path.
create or replace function public.claim_or_login(p_name text, p_pin text)
returns table (player_id uuid, display_name text, is_new boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.players%rowtype;
  v_clean text;
begin
  v_clean := trim(p_name);
  if char_length(v_clean) < 2 or char_length(v_clean) > 20 then
    raise exception 'Name must be 2–20 characters' using errcode = '22023';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits' using errcode = '22023';
  end if;

  select * into v_row from public.players where name_ci = lower(v_clean);

  if v_row.id is null then
    insert into public.players (name, name_ci, pin_hash)
    values (v_clean, lower(v_clean), crypt(p_pin, gen_salt('bf', 8)))
    returning * into v_row;
    return query select v_row.id, v_row.name, true;
  else
    if v_row.pin_hash = crypt(p_pin, v_row.pin_hash) then
      update public.players set last_seen_at = now() where id = v_row.id;
      return query select v_row.id, v_row.name, false;
    else
      raise exception 'Incorrect PIN for that name' using errcode = '28000';
    end if;
  end if;
end;
$$;

grant execute on function public.claim_or_login(text, text) to anon, authenticated;
revoke execute on function public.claim_or_login(text, text) from public;

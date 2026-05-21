-- Defense-in-depth: cap string lengths and switch the leaderboard view to
-- security_invoker so it respects the caller's RLS, not the view creator's.
-- Catches three classes of abuse:
--   1. someone POSTing a 50KB player_name
--   2. someone POSTing a multi-MB player_id to bloat the index
--   3. SELECT bypassing RLS via the view

alter table public.round_results
  add constraint round_results_player_name_len
    check (char_length(player_name) between 1 and 60);

alter table public.round_results
  add constraint round_results_player_id_len
    check (char_length(player_id) between 1 and 64);

drop view if exists public.leaderboard_entries;

create view public.leaderboard_entries
with (security_invoker = true) as
select
  player_id,
  max(player_name) as player_name,
  sum(points_awarded)::bigint as total_points,
  max(score)::int as best_score,
  count(*)::int as rounds,
  min(created_at) as earliest_achieved_at
from public.round_results
group by player_id;

grant select on public.leaderboard_entries to anon, authenticated;

-- The view was joining public.players, but with security_invoker=true the
-- caller (anon) has no SELECT policy on players, so the JOIN returned zero
-- rows. round_results already has a denormalized player_name column with
-- an open SELECT policy — use it directly and drop the join entirely.
--
-- Trade-off: if a user re-claims a name with different capitalization,
-- the leaderboard shows whichever variant was most recently posted as
-- max(player_name). Acceptable for now.

drop view if exists public.leaderboard_entries;

create view public.leaderboard_entries
with (security_invoker = true) as
select
  player_id::text as player_id,
  max(player_name) as player_name,
  sum(points_awarded)::bigint as total_points,
  max(score)::int as best_score,
  count(*)::int as rounds,
  min(created_at) as earliest_achieved_at
from public.round_results
group by player_id;

grant select on public.leaderboard_entries to anon, authenticated;

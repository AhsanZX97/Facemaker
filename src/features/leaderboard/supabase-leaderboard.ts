import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoundResult } from '@/features/round/types';
import type { LeaderboardEntry } from '@/features/leaderboard/types';
import { getSupabase } from '@/lib/supabase';
import { startOfTodayIso } from '@/lib/time';

interface RoundResultRow {
  id: string;
  player_id: string;
  player_name: string;
  score: number;
  points_awarded: number;
  detection_rate: number;
  meta: RoundResult['meta'];
  created_at: string;
}

interface LeaderboardRow {
  player_id: string;
  player_name: string;
  total_points: number | string;
  best_score: number;
  rounds: number;
  earliest_achieved_at: string;
}

export function rowToRoundResult(row: RoundResultRow): RoundResult {
  return {
    id: row.id,
    playerId: row.player_id,
    playerName: row.player_name,
    score: row.score,
    pointsAwarded: row.points_awarded,
    detectionRate: row.detection_rate,
    createdAt: new Date(row.created_at).getTime(),
    meta: row.meta ?? {
      framesSampled: 0,
      framesWithFace: 0,
    },
  };
}

export function rowToLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    playerId: row.player_id,
    playerName: row.player_name,
    totalPoints: Number(row.total_points),
    bestScore: row.best_score,
    rounds: row.rounds,
    earliestAchievedAt: new Date(row.earliest_achieved_at).getTime(),
  };
}

export async function insertRoundResultRemote(
  sb: SupabaseClient,
  input: Omit<RoundResult, 'id' | 'createdAt'>,
): Promise<RoundResult> {
  const payload = {
    player_id: input.playerId,
    player_name: input.playerName,
    score: input.score,
    points_awarded: input.pointsAwarded,
    detection_rate: input.detectionRate,
    meta: input.meta,
  };
  const { data, error } = await sb
    .from('round_results')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToRoundResult(data as RoundResultRow);
}

export async function fetchRoundResultRemote(
  id: string,
): Promise<RoundResult | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('round_results')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToRoundResult(data as RoundResultRow);
}

/**
 * Fetch every round logged since local midnight today.
 * Today's leaderboard is aggregated client-side via `buildLeaderboard`
 * since the volume per day is small.
 */
export async function fetchTodayResultsRemote(): Promise<RoundResult[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('round_results')
    .select('*')
    .gte('created_at', startOfTodayIso())
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  if (!data?.length) return [];
  return (data as RoundResultRow[]).map(rowToRoundResult);
}

/**
 * Count of rounds the given player has logged since local midnight today.
 * Used for the "Today's Run" stat on the home page — survives reloads and
 * device switches because it's keyed on player_id, not local storage.
 */
export async function fetchTodayRoundCountForPlayer(
  playerId: string,
): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { count, error } = await sb
    .from('round_results')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .gte('created_at', startOfTodayIso());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchLeaderboardRemote(): Promise<LeaderboardEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('leaderboard_entries')
    .select('*')
    .order('best_score', { ascending: false })
    .order('earliest_achieved_at', { ascending: true });
  if (error) throw new Error(error.message);
  if (!data?.length) return [];
  return (data as LeaderboardRow[]).map(rowToLeaderboardEntry);
}

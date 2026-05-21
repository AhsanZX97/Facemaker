import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RoundResult } from '@/features/round/types';
import type { LeaderboardEntry } from './types';
import { isRemoteLeaderboardEnabled } from '@/lib/env';
import { insertRoundResultRemote } from '@/features/leaderboard/supabase-leaderboard';
import { getSupabase } from '@/lib/supabase';

interface Player {
  id: string;
  displayName: string;
  createdAt: number;
}

interface LeaderboardState {
  player: Player | null;
  results: RoundResult[];
  /** Set after a successful claim_or_login RPC call (remote mode). */
  setIdentity: (input: { playerId: string; displayName: string }) => Player;
  /** Used in local-only mode when Supabase env vars aren't configured. */
  setLocalPlayer: (displayName: string) => Player;
  forgetPlayer: () => void;
  addResult: (
    result: Omit<RoundResult, 'id' | 'createdAt' | 'playerId' | 'playerName'>,
  ) => Promise<RoundResult>;
  getResultById: (id: string) => RoundResult | undefined;
  reset: () => void;
}

const generateId = () => Math.random().toString(36).slice(2, 11);

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return generateId();
}

export const useLeaderboardStore = create<LeaderboardState>()(
  persist(
    (set, get) => ({
      player: null,
      results: [],
      setIdentity: ({ playerId, displayName }) => {
        const trimmed = displayName.trim() || 'Player';
        const existing = get().player;
        if (existing && existing.id === playerId && existing.displayName === trimmed) {
          return existing;
        }
        const player: Player = {
          id: playerId,
          displayName: trimmed,
          createdAt: existing?.id === playerId ? existing.createdAt : Date.now(),
        };
        set({ player });
        return player;
      },
      setLocalPlayer: (displayName) => {
        const trimmed = displayName.trim();
        const existing = get().player;
        if (existing && existing.displayName === trimmed) return existing;
        const player: Player = existing
          ? { ...existing, displayName: trimmed }
          : {
              id: newLocalId(),
              displayName: trimmed,
              createdAt: Date.now(),
            };
        set({ player });
        return player;
      },
      forgetPlayer: () => set({ player: null, results: [] }),
      addResult: async (partial) => {
        const player = get().player;
        if (!player) {
          throw new Error('Cannot record a result without a player');
        }
        if (isRemoteLeaderboardEnabled()) {
          const sb = getSupabase();
          if (!sb) {
            throw new Error(
              'Supabase is enabled in env but client failed to init',
            );
          }
          const result = await insertRoundResultRemote(sb, {
            ...partial,
            playerId: player.id,
            playerName: player.displayName,
          });
          // Server is the source of truth in remote mode; keep only the most
          // recent round in memory so ResultsPage can read it without a
          // round-trip. Persistence is intentionally turned off for results
          // in remote mode via partialize().
          set({ results: [result] });
          return result;
        }
        const result: RoundResult = {
          ...partial,
          id: newLocalId(),
          playerId: player.id,
          playerName: player.displayName,
          createdAt: Date.now(),
        };
        set((s) => ({ results: [result, ...s.results] }));
        return result;
      },
      getResultById: (id) => get().results.find((r) => r.id === id),
      reset: () => set({ player: null, results: [] }),
    }),
    {
      name: 'trollfaces.leaderboard',
      version: 3,
      partialize: (state) => ({
        player: state.player,
        results: isRemoteLeaderboardEnabled() ? [] : state.results,
      }),
      migrate: (persisted, version) => {
        // v2 → v3: schema unchanged on the client side, but the player.id
        // semantics flipped from random-per-browser to a server-issued uuid.
        // Clear stale local-only ids so users re-claim with name+PIN.
        if (!persisted || typeof persisted !== 'object') {
          return { player: null, results: [] };
        }
        if (version < 3 && isRemoteLeaderboardEnabled()) {
          return { player: null, results: [] };
        }
        return persisted;
      },
    },
  ),
);

export type { LeaderboardEntry } from './types';

/**
 * Aggregate raw results into a sorted leaderboard.
 * Sort:
 *   1. best single-round score (desc)
 *   2. earliest achievement (asc) — first to hit the score wins the tie
 */
export function buildLeaderboard(results: RoundResult[]): LeaderboardEntry[] {
  const byPlayer = new Map<string, LeaderboardEntry>();
  results.forEach((r) => {
    const existing = byPlayer.get(r.playerId);
    if (!existing) {
      byPlayer.set(r.playerId, {
        playerId: r.playerId,
        playerName: r.playerName,
        totalPoints: r.pointsAwarded,
        bestScore: r.score,
        rounds: 1,
        // Track the FIRST time this player hit their current best, so ties
        // go to whoever got there first across the entire history.
        earliestAchievedAt: r.createdAt,
      });
      return;
    }
    if (r.score > existing.bestScore) {
      existing.bestScore = r.score;
      existing.earliestAchievedAt = r.createdAt;
    } else if (r.score === existing.bestScore) {
      existing.earliestAchievedAt = Math.min(
        existing.earliestAchievedAt,
        r.createdAt,
      );
    }
    existing.totalPoints += r.pointsAwarded;
    existing.rounds += 1;
    existing.playerName = r.playerName;
  });
  return [...byPlayer.values()].sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return a.earliestAchievedAt - b.earliestAchievedAt;
  });
}

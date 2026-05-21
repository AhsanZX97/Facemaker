import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLeaderboard, useLeaderboardStore } from './use-leaderboard-store';

// Force the local-only path; otherwise tests will try to hit a real Supabase
// project picked up from the developer's .env file.
vi.stubEnv('VITE_SUPABASE_URL', '');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('useLeaderboardStore', () => {
  beforeEach(() => {
    useLeaderboardStore.getState().reset();
    localStorage.clear();
  });

  it('creates a player on first setLocalPlayer', () => {
    const player = useLeaderboardStore.getState().setLocalPlayer('Ahsan');
    expect(player.displayName).toBe('Ahsan');
    expect(useLeaderboardStore.getState().player?.id).toBe(player.id);
  });

  it('records a round result tied to the current player', async () => {
    useLeaderboardStore.getState().setLocalPlayer('Ahsan');
    const result = await useLeaderboardStore.getState().addResult({
      score: 82,
      pointsAwarded: 82,
      detectionRate: 0.9,
      meta: { framesSampled: 30, framesWithFace: 27 },
    });
    expect(result.playerName).toBe('Ahsan');
    expect(useLeaderboardStore.getState().results).toHaveLength(1);
    expect(useLeaderboardStore.getState().getResultById(result.id)).toEqual(
      result,
    );
  });

  it('throws when adding a result without a player', async () => {
    await expect(
      useLeaderboardStore.getState().addResult({
        score: 50,
        pointsAwarded: 50,
        detectionRate: 1,
        meta: { framesSampled: 10, framesWithFace: 10 },
      }),
    ).rejects.toThrow();
  });
});

describe('buildLeaderboard', () => {
  it('sorts by best score, then earliest hit wins ties', () => {
    const board = buildLeaderboard([
      // Alice: 70 + 30, best 70, lots of rounds
      {
        id: '1',
        playerId: 'a',
        playerName: 'Alice',
        score: 70,
        pointsAwarded: 70,
        detectionRate: 1,
        createdAt: 100,
        meta: { framesSampled: 10, framesWithFace: 10 },
      },
      {
        id: '2',
        playerId: 'a',
        playerName: 'Alice',
        score: 30,
        pointsAwarded: 30,
        detectionRate: 1,
        createdAt: 200,
        meta: { framesSampled: 10, framesWithFace: 10 },
      },
      // Bob: single round, best 100 — wins outright on best score.
      {
        id: '3',
        playerId: 'b',
        playerName: 'Bob',
        score: 100,
        pointsAwarded: 100,
        detectionRate: 1,
        createdAt: 50,
        meta: { framesSampled: 10, framesWithFace: 10 },
      },
      // Carol: tied best 70 with Alice, but hit it earlier — wins tie.
      {
        id: '4',
        playerId: 'c',
        playerName: 'Carol',
        score: 70,
        pointsAwarded: 70,
        detectionRate: 1,
        createdAt: 80,
        meta: { framesSampled: 10, framesWithFace: 10 },
      },
    ]);

    expect(board[0]).toMatchObject({ playerId: 'b', bestScore: 100 });
    expect(board[1]).toMatchObject({ playerId: 'c', bestScore: 70 });
    expect(board[2]).toMatchObject({ playerId: 'a', bestScore: 70 });
  });
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Loader2, Play, RefreshCw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RuleLine } from '@/components/ui/rule-line';
import { cn } from '@/lib/utils';
import {
  fetchLeaderboardRemote,
  fetchTodayResultsRemote,
} from '@/features/leaderboard/supabase-leaderboard';
import { isRemoteLeaderboardEnabled } from '@/lib/env';
import { startOfTodayMs } from '@/lib/time';
import type { LeaderboardEntry } from '@/features/leaderboard/types';
import {
  buildLeaderboard,
  useLeaderboardStore,
} from '@/features/leaderboard/use-leaderboard-store';

const TIERS: { min: number; label: string }[] = [
  { min: 90, label: 'The Troll' },
  { min: 75, label: 'Grinner' },
  { min: 55, label: 'Apprentice' },
  { min: 0, label: 'Amateur' },
];

function tierFor(bestScore: number) {
  return TIERS.find((t) => bestScore >= t.min) ?? TIERS[TIERS.length - 1];
}

type TabId = 'today' | 'all';

const TAB_META: Record<
  TabId,
  { label: string; heading: string; subtitle: string; rule: string }
> = {
  today: {
    label: 'Today',
    heading: 'Top Troll of the Day',
    subtitle:
      "Today's rounds only · resets at midnight · earliest hit wins ties.",
    rule: 'Daily Standings',
  },
  all: {
    label: 'All Time',
    heading: 'Hall of Trolls',
    subtitle: 'Ranked by best single-round score · earliest hit wins ties.',
    rule: 'Standings',
  },
};

export function LeaderboardPage() {
  const results = useLeaderboardStore((s) => s.results);
  const player = useLeaderboardStore((s) => s.player);
  const remoteEnabled = isRemoteLeaderboardEnabled();

  const [tab, setTab] = useState<TabId>('today');

  const localBoardAll = useMemo(() => buildLeaderboard(results), [results]);
  const localBoardToday = useMemo(() => {
    const since = startOfTodayMs();
    return buildLeaderboard(results.filter((r) => r.createdAt >= since));
  }, [results]);

  const [remoteAll, setRemoteAll] = useState<LeaderboardEntry[] | null>(null);
  const [remoteToday, setRemoteToday] = useState<LeaderboardEntry[] | null>(
    null,
  );
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  // Refs so the callbacks don't capture stale state and so the fetch
  // identity stays stable across re-renders (no useEffect storms).
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const refresh = useCallback(() => {
    if (!remoteEnabled) {
      setRemoteAll(null);
      setRemoteToday(null);
      setRemoteError(null);
      return;
    }
    if (cancelRef.current) cancelRef.current.cancelled = true;
    const token = { cancelled: false };
    cancelRef.current = token;
    setRemoteLoading(true);
    setRemoteError(null);
    Promise.all([fetchLeaderboardRemote(), fetchTodayResultsRemote()])
      .then(([all, todayRows]) => {
        if (token.cancelled) return;
        setRemoteAll(all);
        setRemoteToday(buildLeaderboard(todayRows));
        setLastFetchedAt(Date.now());
      })
      .catch((e: unknown) => {
        if (token.cancelled) return;
        setRemoteAll((prev) => prev ?? []);
        setRemoteToday((prev) => prev ?? []);
        setRemoteError(
          e instanceof Error ? e.message : 'Could not reach the leaderboard.',
        );
      })
      .finally(() => {
        if (!token.cancelled) setRemoteLoading(false);
      });
  }, [remoteEnabled]);

  // Initial load + cleanup.
  useEffect(() => {
    refresh();
    return () => {
      if (cancelRef.current) cancelRef.current.cancelled = true;
    };
  }, [refresh]);

  // Re-fetch when the tab regains focus or becomes visible — handles the
  // "came back from another tab / locked phone" case so today's board
  // doesn't stay frozen on stale data.
  useEffect(() => {
    if (!remoteEnabled) return;
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, remoteEnabled]);

  const board = useMemo(() => {
    if (remoteEnabled) {
      const remote = tab === 'today' ? remoteToday : remoteAll;
      return remote ?? [];
    }
    return tab === 'today' ? localBoardToday : localBoardAll;
  }, [remoteEnabled, tab, remoteToday, remoteAll, localBoardToday, localBoardAll]);

  const showRemoteSpinner =
    remoteEnabled &&
    remoteLoading &&
    (tab === 'today' ? remoteToday === null : remoteAll === null);

  const myRank = useMemo(() => {
    if (!player) return null;
    const idx = board.findIndex((b) => b.playerId === player.id);
    return idx === -1 ? null : idx + 1;
  }, [board, player]);

  const meta = TAB_META[tab];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          {remoteEnabled ? 'Global · Live' : 'This Browser Only'}
        </span>
        <h1 className="masthead text-5xl sm:text-7xl">{meta.heading}</h1>
        <p className="max-w-md text-pretty font-mono text-[11px] uppercase tracking-stamp text-muted-fg">
          {meta.subtitle}
        </p>
        <RuleLine label={meta.rule} />
      </header>

      <div className="flex justify-center">
        <Tabs value={tab} onChange={setTab} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono text-[11px] uppercase tracking-stamp text-muted-fg">
          {myRank ? (
            <>
              You stand at{' '}
              <span className="font-bold text-ink">rank #{myRank}</span>
              {tab === 'today' ? ' today' : ''}
            </>
          ) : tab === 'today' ? (
            <>You haven't ranked today — play a round.</>
          ) : (
            <>You haven't ranked yet — play a round.</>
          )}
        </span>
        <div className="flex items-center gap-2">
          {remoteEnabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={remoteLoading}
              title={
                lastFetchedAt
                  ? `Last updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
                  : 'Refresh'
              }
              aria-label="Refresh leaderboard"
            >
              <RefreshCw
                className={cn('h-4 w-4', remoteLoading && 'animate-spin')}
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          ) : null}
          <Button asChild variant="accent" size="default">
            <Link to="/play">
              <Play className="h-4 w-4" /> Play
            </Link>
          </Button>
        </div>
      </div>

      {remoteError ? (
        <div
          role="alert"
          className="border-2 border-destructive bg-destructive/10 px-4 py-3 font-mono text-[11px] text-destructive"
        >
          Couldn't reach the leaderboard server: {remoteError}
        </div>
      ) : null}

      <div className="ink-box overflow-hidden">
        {showRemoteSpinner ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-fg">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="font-mono text-[10px] uppercase tracking-stamp">
              Loading leaderboard…
            </p>
          </div>
        ) : board.length === 0 ? (
          <EmptyState today={tab === 'today'} />
        ) : (
          <ol>
            <li className="hidden border-b-2 border-ink bg-secondary px-5 py-3 font-mono text-[10px] uppercase tracking-stamp text-muted-fg sm:grid sm:grid-cols-[60px,1fr,140px,80px,80px] sm:items-center">
              <span>Rank</span>
              <span>Player</span>
              <span>Tier</span>
              <span className="text-right">Tries</span>
              <span className="text-right">Best</span>
            </li>
            {board.map((entry, i) => {
              const isMe = entry.playerId === player?.id;
              const t = tierFor(entry.bestScore);
              return (
                <li
                  key={entry.playerId}
                  className={cn(
                    'flex flex-col gap-2 border-b border-ink/30 px-4 py-3 sm:grid sm:grid-cols-[60px,1fr,140px,80px,80px] sm:items-center sm:gap-3 sm:px-5 sm:py-4',
                    'animate-fade-up',
                    isMe && 'bg-accent/10',
                    'last:border-b-0',
                  )}
                  style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
                >
                  <RankBadge rank={i + 1} />
                  <div className="flex flex-1 items-baseline gap-2">
                    <span className="font-display text-lg uppercase leading-none">
                      {entry.playerName}
                    </span>
                    {isMe ? (
                      <span className="font-mono text-[10px] uppercase tracking-stamp text-accent">
                        (you)
                      </span>
                    ) : null}
                  </div>
                  <span className="hidden border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-stamp text-ink sm:inline-block sm:w-fit">
                    {t.label}
                  </span>
                  <div className="flex items-baseline justify-between text-right sm:block">
                    <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg sm:hidden">
                      Tries
                    </span>
                    <span className="font-mono tabular text-base text-muted-fg">
                      {entry.rounds}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-right sm:block">
                    <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg sm:hidden">
                      Best
                    </span>
                    <span className="font-display text-2xl leading-none tabular">
                      {entry.bestScore}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <p className="text-center font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
        Keep trolling
      </p>
    </div>
  );
}

interface TabsProps {
  value: TabId;
  onChange: (next: TabId) => void;
}

function Tabs({ value, onChange }: TabsProps) {
  const tabs: TabId[] = ['today', 'all'];
  return (
    <div
      role="tablist"
      aria-label="Leaderboard view"
      className="inline-flex border-2 border-ink bg-paper shadow-stamp-sm"
    >
      {tabs.map((id) => {
        const active = value === id;
        return (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn(
              'px-5 py-2.5 font-mono text-[11px] uppercase tracking-stamp transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              active
                ? 'bg-ink text-paper'
                : 'bg-paper text-ink hover:bg-secondary',
            )}
          >
            {TAB_META[id].label}
          </button>
        );
      })}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const isPodium = rank <= 3;
  if (rank === 1) {
    return (
      <div
        className="relative flex h-12 w-12 shrink-0 items-center justify-center border-2 border-ink bg-accent text-accent-foreground shadow-stamp-sm"
        title="Champion"
      >
        <Crown className="h-5 w-5" />
        <span className="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center border-2 border-ink bg-paper font-mono text-[8px] font-bold text-ink">
          1
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center border-2 border-ink font-display text-xl tabular leading-none shadow-stamp-sm',
        rank === 2 && 'bg-secondary text-ink',
        rank === 3 && 'bg-amber-300 text-ink',
        !isPodium && 'bg-paper text-ink',
      )}
    >
      {rank}
    </div>
  );
}

function EmptyState({ today }: { today: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center border-2 border-ink bg-paper shadow-stamp-sm">
        <Trophy className="h-8 w-8 text-muted-fg" />
      </div>
      <p className="font-display text-3xl uppercase leading-none">
        {today ? 'No rounds today' : 'No rounds yet'}
      </p>
      <p className="font-mono text-[11px] uppercase tracking-stamp text-muted-fg">
        {today
          ? 'Be the first to log a score today'
          : 'Play one round to take the top spot'}
      </p>
      <Button asChild variant="accent" className="mt-2">
        <Link to="/play">
          <Play className="h-4 w-4" /> {today ? 'Play now' : 'Play first round'}
        </Link>
      </Button>
    </div>
  );
}

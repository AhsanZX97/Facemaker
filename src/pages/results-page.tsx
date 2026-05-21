import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Repeat, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RuleLine } from '@/components/ui/rule-line';
import { StampedNumber } from '@/components/ui/stamped-number';
import type { LeaderboardEntry } from '@/features/leaderboard/types';
import {
  buildLeaderboard,
  useLeaderboardStore,
} from '@/features/leaderboard/use-leaderboard-store';
import {
  fetchLeaderboardRemote,
  fetchRoundResultRemote,
} from '@/features/leaderboard/supabase-leaderboard';
import { isRemoteLeaderboardEnabled } from '@/lib/env';
import type { RoundResult } from '@/features/round/types';
import { ReferenceFace } from '@/features/round/reference-face';
import { cn } from '@/lib/utils';

export function ResultsPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const storeResult = useLeaderboardStore((s) =>
    roundId ? s.getResultById(roundId) : undefined,
  );
  const results = useLeaderboardStore((s) => s.results);
  const player = useLeaderboardStore((s) => s.player);

  const [remoteResult, setRemoteResult] = useState<RoundResult | null>(null);
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const remoteEnabled = isRemoteLeaderboardEnabled();

  useEffect(() => {
    if (!roundId || storeResult || !remoteEnabled) return;
    let cancelled = false;
    setFetchingRemote(true);
    fetchRoundResultRemote(roundId)
      .then((data) => {
        if (!cancelled) setRemoteResult(data);
      })
      .catch(() => {
        if (!cancelled) setRemoteResult(null);
      })
      .finally(() => {
        if (!cancelled) setFetchingRemote(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roundId, storeResult, remoteEnabled]);

  const result = storeResult ?? remoteResult;

  const [remoteBoard, setRemoteBoard] = useState<LeaderboardEntry[] | null>(
    null,
  );

  useEffect(() => {
    if (!player || !result) return;
    if (!remoteEnabled) {
      setRemoteBoard(null);
      return;
    }
    let cancelled = false;
    fetchLeaderboardRemote()
      .then((data) => {
        if (!cancelled) setRemoteBoard(data);
      })
      .catch(() => {
        if (!cancelled) setRemoteBoard([]);
      });
    return () => {
      cancelled = true;
    };
  }, [player, result, remoteEnabled]);

  const rank = useMemo(() => {
    if (!player) return null;
    if (remoteEnabled) {
      if (remoteBoard === null) return null;
      const idx = remoteBoard.findIndex((b) => b.playerId === player.id);
      return idx === -1 ? null : idx + 1;
    }
    const board = buildLeaderboard(results);
    const idx = board.findIndex((b) => b.playerId === player.id);
    return idx === -1 ? null : idx + 1;
  }, [player, results, remoteBoard, remoteEnabled]);

  if (fetchingRemote) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-fg" />
        <p className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Loading round…
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <span className="font-display text-6xl uppercase">404</span>
        <p className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          That round was not found
        </p>
        <Button onClick={() => navigate('/')}>Back to home</Button>
      </div>
    );
  }

  const isZero = result.score === 0;
  const isNoFace = result.detectionRate === 0;
  const headline = isNoFace
    ? 'No Face Found'
    : isZero
    ? 'Detection Too Low'
    : verdictForScore(result.score);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 sm:gap-8">
      <header className="flex flex-col items-center gap-2 text-center sm:gap-3">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Round Complete · {result.playerName}
        </span>
        <h1 className="masthead text-balance text-4xl sm:text-7xl">
          {headline}
        </h1>
        <RuleLine label="The verdict" />
      </header>

      <div className="ink-box flex flex-col items-center gap-4 p-4 sm:gap-8 sm:p-10">
        <ReferenceFace size="md" caption="Versus the reference" />

        <StampedNumber
          value={result.score}
          label="Similarity Score · / 100"
          tone={isZero ? 'ink' : 'accent'}
        />

        <div className="grid w-full grid-cols-2 gap-3 sm:gap-4">
          <Stat
            label="Points Earned"
            value={`+${result.pointsAwarded}`}
            tone="accent"
          />
          <Stat
            label="Face Detected"
            value={`${Math.round(result.detectionRate * 100)}%`}
            tone={result.detectionRate >= 0.7 ? 'success' : 'warning'}
          />
        </div>

        <div className="flex w-full flex-col gap-2">
          <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
            <span>Detection across the round</span>
            <span className="tabular">
              {result.meta.framesWithFace}/{result.meta.framesSampled} frames
            </span>
          </div>
          <Progress value={result.detectionRate * 100} tone="ink" />
        </div>

        {rank ? (
          <Badge variant="accent" className="text-[11px]">
            <Trophy className="h-3 w-3" /> Rank #{rank}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row [&>*]:w-full sm:[&>*]:flex-1 sm:[&>*]:w-auto">
        <Button
          size="lg"
          variant="accent"
          onClick={() => navigate('/play')}
        >
          <Repeat className="h-4 w-4" /> Play again
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to="/leaderboard">
            <Trophy className="h-4 w-4" /> Leaderboard
          </Link>
        </Button>
      </div>
    </div>
  );
}

function verdictForScore(score: number): string {
  if (score >= 90) return 'The Troll Lives';
  if (score >= 75) return 'Certified Troll';
  if (score >= 55) return 'Solid Grin';
  if (score >= 35) return 'Needs More Smirk';
  return 'Try Harder';
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'accent' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-500 text-ink'
      : tone === 'warning'
      ? 'bg-amber-300 text-ink'
      : 'bg-accent text-accent-foreground';
  return (
    <div className={cn('border-2 border-ink p-3 sm:p-4', toneClass)}>
      <div className="font-mono text-[10px] uppercase tracking-stamp opacity-80">
        {label}
      </div>
      <div className="font-display text-3xl leading-none tabular sm:text-4xl">
        {value}
      </div>
    </div>
  );
}

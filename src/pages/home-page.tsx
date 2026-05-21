import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Camera,
  Loader2,
  LogOut,
  Smile,
  Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EditionBadge } from '@/components/ui/edition-badge';
import { RuleLine } from '@/components/ui/rule-line';
import { useLeaderboardStore } from '@/features/leaderboard/use-leaderboard-store';
import { claimOrLogin } from '@/features/identity/claim-or-login';
import { fetchTodayRoundCountForPlayer } from '@/features/leaderboard/supabase-leaderboard';
import { isRemoteLeaderboardEnabled } from '@/lib/env';
import { cn } from '@/lib/utils';

const MAX_NAME = 20;
const MIN_NAME = 2;
const PIN_LENGTH = 4;

export function HomePage() {
  const navigate = useNavigate();
  const remoteEnabled = isRemoteLeaderboardEnabled();
  const setIdentity = useLeaderboardStore((s) => s.setIdentity);
  const setLocalPlayer = useLeaderboardStore((s) => s.setLocalPlayer);
  const forgetPlayer = useLeaderboardStore((s) => s.forgetPlayer);
  const existingPlayer = useLeaderboardStore((s) => s.player);
  const localResultsCount = useLeaderboardStore((s) => s.results.length);

  // In remote mode, the "Today's Run" count is fetched per-player from
  // Supabase so it survives reloads and matches across devices. In
  // local-only mode it just reflects this device's stored rounds.
  const [todayRoundCount, setTodayRoundCount] = useState<number | null>(null);
  useEffect(() => {
    if (!remoteEnabled || !existingPlayer) {
      setTodayRoundCount(null);
      return;
    }
    let cancelled = false;
    fetchTodayRoundCountForPlayer(existingPlayer.id)
      .then((n) => {
        if (!cancelled) setTodayRoundCount(n);
      })
      .catch(() => {
        if (!cancelled) setTodayRoundCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [remoteEnabled, existingPlayer]);

  const todayDisplayCount =
    remoteEnabled && existingPlayer
      ? todayRoundCount ?? 0
      : localResultsCount;

  const editionNo = useMemo(() => {
    const start = new Date(2026, 0, 1).getTime();
    const day = Math.floor((Date.now() - start) / 86_400_000);
    return String(day).padStart(3, '0');
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 sm:gap-16">
      <header className="flex flex-col items-center gap-5 text-center">
        <EditionBadge no={editionNo} label="Daily Edition" />

        <div className="relative">
          <h1 className="masthead text-balance text-[18vw] sm:text-[120px] lg:text-[156px]">
            Troll<span className="text-accent">Faces</span>
          </h1>
          <span
            aria-hidden
            className="pointer-events-none absolute -right-2 top-2 hidden -rotate-6 border-2 border-ink bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-stamp text-accent-foreground shadow-stamp-sm sm:block"
          >
            Hot off the press
          </span>
        </div>

        <p className="max-w-xl text-pretty font-mono text-xs uppercase tracking-stamp text-muted-fg sm:text-sm">
          The 10-second troll-face challenge. Match the meme. Score the points.
          Climb the leaderboard.
        </p>

        <RuleLine label="Vol. I" />
      </header>

      <section className="grid gap-8 lg:grid-cols-[1.2fr,1fr] lg:items-center">
        <div className="ink-box p-6 sm:p-8">
          {existingPlayer ? (
            <ReturningPlayer
              displayName={existingPlayer.displayName}
              onPlay={() => navigate('/play')}
              onLeaderboard={() => navigate('/leaderboard')}
              onSwitch={() => forgetPlayer()}
            />
          ) : remoteEnabled ? (
            <NamePinForm
              onSuccess={({ playerId, displayName }) => {
                setIdentity({ playerId, displayName });
                navigate('/play');
              }}
              onLeaderboard={() => navigate('/leaderboard')}
            />
          ) : (
            <NameOnlyForm
              onSuccess={(name) => {
                setLocalPlayer(name);
                navigate('/play');
              }}
              onLeaderboard={() => navigate('/leaderboard')}
            />
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:gap-5">
          <StatBox
            kicker="Today's Run"
            number={todayDisplayCount}
            unit={
              remoteEnabled && existingPlayer
                ? 'rounds you logged today'
                : remoteEnabled
                ? 'rounds today (sign in to track)'
                : 'rounds played on this device'
            }
          />
          <StatBox
            kicker="Round Length"
            number={10}
            unit="seconds. that's the whole game."
            tone="accent"
          />
          <div className="ink-box flex items-start gap-3 p-4">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center border-2 border-ink bg-accent text-[10px] font-bold text-accent-foreground">
              !
            </span>
            <p className="font-mono text-[11px] leading-relaxed text-ink">
              Camera frames stay on your device. Only your score and name leave
              the browser.
            </p>
          </div>
        </aside>
      </section>

      <RuleLine label="How to play" glyph="●●●" />

      <section className="grid gap-4 sm:grid-cols-3">
        <HowStep
          n={1}
          icon={<Camera className="h-5 w-5" />}
          title="Allow camera"
          desc="Processed on-device. Nothing uploaded."
        />
        <HowStep
          n={2}
          icon={<Smile className="h-5 w-5" />}
          title="Match the face"
          desc="Wide grin, squinted eyes, no mercy."
        />
        <HowStep
          n={3}
          icon={<Trophy className="h-5 w-5" />}
          title="Score points"
          desc="Best run climbs the daily ranks."
        />
      </section>
    </div>
  );
}

function NamePinForm({
  onSuccess,
  onLeaderboard,
}: {
  onSuccess: (id: { playerId: string; displayName: string }) => void;
  onLeaderboard: () => void;
}) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const isNameValid =
    trimmedName.length >= MIN_NAME && trimmedName.length <= MAX_NAME;
  const isPinValid = /^[0-9]{4}$/.test(pin);
  const canSubmit = isNameValid && isPinValid && !loading;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const result = await claimOrLogin(trimmedName, pin);
      onSuccess({
        playerId: result.playerId,
        displayName: result.displayName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Step 01 — Identify
        </span>
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg tabular">
          {trimmedName.length}/{MAX_NAME}
        </span>
      </div>

      <label
        htmlFor="display-name"
        className="font-display text-3xl uppercase leading-none sm:text-4xl"
      >
        Pick a name & PIN
      </label>

      <div className="grid gap-3 sm:grid-cols-[1fr,140px]">
        <Input
          id="display-name"
          value={name}
          maxLength={MAX_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="troll_lord"
          aria-describedby="form-help"
          autoFocus
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
        />
        <Input
          id="pin"
          value={pin}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          onChange={(e) =>
            setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH))
          }
          placeholder="4-digit PIN"
          autoComplete="off"
          className="tabular tracking-[0.4em]"
        />
      </div>

      <p
        id="form-help"
        className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg"
      >
        New name? It's yours after this. Already taken? Enter the right PIN to
        keep racking up points across devices.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">
        <Button
          type="submit"
          size="lg"
          variant="accent"
          className="flex-1"
          disabled={!canSubmit}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </>
          ) : !isNameValid ? (
            'Enter a name (2–20)'
          ) : !isPinValid ? (
            'Enter a 4-digit PIN'
          ) : (
            <>
              Press Start
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={onLeaderboard}
        >
          <Trophy className="h-4 w-4" /> Leaderboard
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-2 border-destructive bg-destructive/10 p-3 font-mono text-[11px] text-destructive"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

function NameOnlyForm({
  onSuccess,
  onLeaderboard,
}: {
  onSuccess: (name: string) => void;
  onLeaderboard: () => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const isValid = trimmed.length >= MIN_NAME && trimmed.length <= MAX_NAME;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onSuccess(trimmed);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Step 01 — Identify
        </span>
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg tabular">
          {trimmed.length}/{MAX_NAME}
        </span>
      </div>

      <label
        htmlFor="display-name"
        className="font-display text-3xl uppercase leading-none sm:text-4xl"
      >
        What do we call you?
      </label>

      <Input
        id="display-name"
        value={name}
        maxLength={MAX_NAME}
        onChange={(e) => setName(e.target.value)}
        placeholder="troll_lord"
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />

      <p className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
        2–20 characters. Stays in your browser until Supabase is wired up.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">
        <Button
          type="submit"
          size="lg"
          variant="accent"
          className="flex-1"
          disabled={!isValid}
        >
          {isValid ? 'Press Start' : 'Enter a name to play'}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={onLeaderboard}
        >
          <Trophy className="h-4 w-4" /> Leaderboard
        </Button>
      </div>
    </form>
  );
}

function ReturningPlayer({
  displayName,
  onPlay,
  onLeaderboard,
  onSwitch,
}: {
  displayName: string;
  onPlay: () => void;
  onLeaderboard: () => void;
  onSwitch: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Step 01 — Welcome back
        </span>
        <span className="inline-flex items-center gap-1.5 border-2 border-ink bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-stamp text-accent-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-foreground" />
          Signed in
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Playing as
        </span>
        <span className="font-display text-3xl uppercase leading-none sm:text-4xl">
          {displayName}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">
        <Button
          type="button"
          size="lg"
          variant="accent"
          className="flex-1"
          onClick={onPlay}
        >
          Press Start
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={onLeaderboard}
        >
          <Trophy className="h-4 w-4" /> Leaderboard
        </Button>
      </div>

      <button
        type="button"
        onClick={onSwitch}
        className="self-start font-mono text-[10px] uppercase tracking-stamp text-muted-fg underline-offset-[6px] hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <LogOut className="mr-1 inline h-3 w-3" /> Switch player
      </button>
    </div>
  );
}

function StatBox({
  kicker,
  number,
  unit,
  tone = 'ink',
}: {
  kicker: string;
  number: number;
  unit: string;
  tone?: 'ink' | 'accent';
}) {
  return (
    <div
      className={cn(
        'ink-box flex flex-col gap-1 p-4 sm:p-5',
        tone === 'accent' && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-stamp opacity-80">
        {kicker}
      </span>
      <span className="font-display text-5xl leading-none tabular sm:text-6xl">
        {number}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-stamp opacity-80">
        {unit}
      </span>
    </div>
  );
}

function HowStep({
  n,
  icon,
  title,
  desc,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="ink-box flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Step {String(n).padStart(2, '0')}
        </span>
        <span className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-accent text-accent-foreground">
          {icon}
        </span>
      </div>
      <div className="font-display text-2xl uppercase leading-none">
        {title}
      </div>
      <p className="text-sm text-muted-fg">{desc}</p>
    </div>
  );
}

import { Link, NavLink } from 'react-router-dom';
import { LogOut, Trophy } from 'lucide-react';
import { useLeaderboardStore } from '@/features/leaderboard/use-leaderboard-store';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { MarqueeStrip } from '@/components/ui/marquee-strip';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const player = useLeaderboardStore((s) => s.player);
  const forgetPlayer = useLeaderboardStore((s) => s.forgetPlayer);

  const today = new Date();
  const dateLabel = today.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
        <div className="container flex h-14 items-center justify-between gap-3 sm:h-16">
          <Link
            to="/"
            className="group flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="relative inline-flex h-9 w-9 items-center justify-center border-2 border-ink bg-paper shadow-stamp-sm transition-transform group-hover:-rotate-3 sm:h-10 sm:w-10">
              <img
                src="/trollface.png"
                alt=""
                className="h-7 w-7 object-contain sm:h-8 sm:w-8"
                aria-hidden
              />
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-display text-xl uppercase tracking-tight sm:text-2xl">
                TrollFaces
              </span>
              <span className="hidden font-mono text-[9px] uppercase tracking-stamp text-muted-fg sm:block">
                Daily Edition · {dateLabel}
              </span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            {player ? (
              <span
                className="hidden items-center gap-2 border-2 border-ink bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-stamp text-ink sm:inline-flex"
                title={player.displayName}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="max-w-[8rem] truncate normal-case tracking-normal">
                  {player.displayName}
                </span>
              </span>
            ) : null}

            <NavLink
              to="/leaderboard"
              className={({ isActive }) =>
                cn(
                  'inline-flex h-10 items-center gap-1.5 border-2 border-ink px-3 font-mono text-[10px] uppercase tracking-stamp transition-[transform,box-shadow,background-color]',
                  'shadow-stamp-sm hover:translate-x-[1.5px] hover:translate-y-[1.5px] hover:shadow-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isActive
                    ? 'bg-ink text-paper'
                    : 'bg-paper text-ink hover:bg-paper',
                )
              }
            >
              <Trophy className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Leaderboard</span>
              <span className="sm:hidden">Ranks</span>
            </NavLink>

            {player ? (
              <button
                type="button"
                onClick={() => forgetPlayer()}
                aria-label="Switch player"
                title="Switch player"
                className={cn(
                  'inline-flex h-10 items-center gap-1.5 border-2 border-ink bg-paper px-3 font-mono text-[10px] uppercase tracking-stamp text-ink transition-[transform,box-shadow,background-color]',
                  'shadow-stamp-sm hover:translate-x-[1.5px] hover:translate-y-[1.5px] hover:shadow-none hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Switch</span>
              </button>
            ) : null}

            <ThemeToggle />
          </nav>
        </div>
        <MarqueeStrip />
      </header>

      <main className="container relative flex-1 py-8 sm:py-10 lg:py-14">
        {children}
      </main>

      <footer className="border-t-2 border-ink bg-paper">
        <div className="container flex flex-col gap-2 py-4 text-[10px] uppercase tracking-stamp text-muted-fg sm:flex-row sm:items-center sm:justify-between">
          <span className="font-mono">
            © {today.getFullYear()} TrollFaces · Printed Daily
          </span>
          <span className="font-mono">
            Camera processed on-device · Score + name only leaves the browser
          </span>
        </div>
      </footer>
    </div>
  );
}

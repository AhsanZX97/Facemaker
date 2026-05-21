import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThemeProvider } from '@/components/theme-provider';
import { HomePage } from '@/pages/home-page';
import { PlayPage } from '@/pages/play-page';
import { ResultsPage } from '@/pages/results-page';
import { LeaderboardPage } from '@/pages/leaderboard-page';
import { CalibratePage } from '@/pages/calibrate-page';

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/results/:roundId" element={<ResultsPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/calibrate" element={<CalibratePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

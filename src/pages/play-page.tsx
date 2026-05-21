import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Play, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RuleLine } from '@/components/ui/rule-line';
import { CameraPreview } from '@/features/round/camera-preview';
import { FaceStatus } from '@/features/round/face-status';
import { ReferenceFace } from '@/features/round/reference-face';
import { DebugOverlay } from '@/features/round/debug-overlay';
import { useCamera } from '@/features/round/use-camera';
import { useFaceLandmarker } from '@/features/round/use-face-landmarker';
import { useRoundTimer } from '@/features/round/use-round-timer';
import {
  frameFromDetection,
  pointsForScore,
  scoreRound,
} from '@/features/round/scoring';
import type { FrameSample, RoundPhase } from '@/features/round/types';
import { useLeaderboardStore } from '@/features/leaderboard/use-leaderboard-store';
import { cn } from '@/lib/utils';

const ROUND_SECONDS = 10;
const COUNTDOWN_SECONDS = 3;
const SAMPLE_INTERVAL_MS = 100;

export function PlayPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const debugMode = searchParams.get('debug') === '1';
  const player = useLeaderboardStore((s) => s.player);
  const addResult = useLeaderboardStore((s) => s.addResult);

  const [phase, setPhase] = useState<RoundPhase>('permission');
  const [countdown, setCountdown] = useState<number>(COUNTDOWN_SECONDS);
  const [faceDetected, setFaceDetected] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Latest frame + running tally power the live signals panel during the
  // round. Updated every sample (10/s) which is cheap — only the panel
  // sub-tree re-renders.
  const [latestSample, setLatestSample] = useState<FrameSample | null>(null);
  const [debugCounts, setDebugCounts] = useState({ total: 0, withFace: 0 });

  const camera = useCamera({ width: 640, height: 480 });
  const landmarker = useFaceLandmarker();

  const samplesRef = useRef<FrameSample[]>([]);
  const samplerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);

  const onComplete = useCallback(() => {
    setPhase('scoring');
  }, []);

  const timer = useRoundTimer(ROUND_SECONDS, onComplete);

  useEffect(() => {
    if (!player) navigate('/', { replace: true });
  }, [player, navigate]);

  const sampleFrame = useCallback(() => {
    const video = camera.videoRef.current;
    if (!video) return;
    const ts = performance.now();
    const result = landmarker.detect(video, ts);

    // Distinguish "model wasn't ready / video frame not ready" (null result)
    // from "model ran but found no face." Only the latter counts against
    // detection rate; the former is silently skipped so the 0.7 threshold
    // doesn't punish players for warmup time.
    if (result == null) return;

    const sample = frameFromDetection(result, ts);
    samplesRef.current.push(sample);
    setFaceDetected(sample.detected);

    if (!sample.detected) {
      setHint('Move your face into the frame');
    } else if (sample.pose && !sample.pose.ok) {
      setHint('Face the camera straight on');
    } else if (sample.effort && sample.effort.wide < 0.4) {
      setHint('Wider grin!');
    } else if (sample.effort && sample.effort.smileGate < 0.4) {
      setHint('Show teeth — part those lips');
    } else {
      setHint(null);
    }

    setLatestSample(sample);
    setDebugCounts((prev) => ({
      total: prev.total + 1,
      withFace: prev.withFace + (sample.detected ? 1 : 0),
    }));
  }, [camera.videoRef, landmarker]);

  const startSampling = useCallback(() => {
    samplesRef.current = [];
    setDebugCounts({ total: 0, withFace: 0 });
    setLatestSample(null);
    if (samplerRef.current) window.clearInterval(samplerRef.current);
    samplerRef.current = window.setInterval(sampleFrame, SAMPLE_INTERVAL_MS);
  }, [sampleFrame]);

  const stopSampling = useCallback(() => {
    if (samplerRef.current) {
      window.clearInterval(samplerRef.current);
      samplerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopSampling();
      if (countdownRef.current) window.clearInterval(countdownRef.current);
    };
  }, [stopSampling]);

  const handleRequestCamera = async () => {
    await camera.request();
  };

  useEffect(() => {
    if (
      phase === 'permission' &&
      camera.status === 'granted' &&
      landmarker.status === 'ready'
    ) {
      setPhase('ready');
    }
  }, [phase, camera.status, landmarker.status]);

  const handleStartRound = () => {
    if (phase !== 'ready') return;
    setSaveError(null);
    setPhase('countdown');
    setCountdown(COUNTDOWN_SECONDS);
    let n = COUNTDOWN_SECONDS;
    countdownRef.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownRef.current) window.clearInterval(countdownRef.current);
        countdownRef.current = null;
        setPhase('running');
        startSampling();
        timer.start();
      } else {
        setCountdown(n);
      }
    }, 1000);
  };

  useEffect(() => {
    if (phase !== 'scoring') return;
    stopSampling();
    const t = window.setTimeout(() => {
      void (async () => {
        const out = scoreRound({ samples: samplesRef.current });
        const points = pointsForScore(out.score);
        try {
          const result = await addResult({
            score: out.score,
            pointsAwarded: points,
            detectionRate: out.detectionRate,
            meta: {
              framesSampled: out.framesSampled,
              framesWithFace: out.framesWithFace,
              avgSignals: out.avgSignals ?? undefined,
            },
          });
          camera.stop();
          navigate(`/results/${result.id}`, { replace: true });
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : 'Could not save your round.';
          setSaveError(msg);
          setPhase('ready');
          timer.reset(ROUND_SECONDS);
        }
      })();
    }, 800);
    return () => window.clearTimeout(t);
  }, [phase, addResult, camera, navigate, stopSampling, timer]);

  const timerPct = useMemo(
    () => ((ROUND_SECONDS - timer.remaining) / ROUND_SECONDS) * 100,
    [timer.remaining],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      {/* Header strip */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
            Round in progress · One take only
          </span>
          <h1 className="font-display text-4xl uppercase leading-none sm:text-5xl">
            Hi, {player?.displayName}
          </h1>
          <p className="text-sm text-muted-fg">
            Match the troll face. You have{' '}
            <span className="font-mono font-bold text-ink">
              {ROUND_SECONDS}s
            </span>
            .
          </p>
        </div>
        <ReferenceFace size="sm" caption={null} />
      </header>

      <RuleLine glyph="●●●" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.7fr,1fr]">
        <CameraPreview
          videoRef={camera.videoRef}
          showScanlines={phase === 'running'}
          overlay={
            <RoundOverlay
              phase={phase}
              countdown={countdown}
              timerPct={timerPct}
              remaining={timer.remaining}
            />
          }
        />

        <aside className="ink-box flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
              Vitals
            </span>
            <PhaseBadge phase={phase} />
          </div>

          <FaceStatus
            detected={faceDetected && phase === 'running'}
            hint={phase === 'running' ? hint : null}
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
              <span>Time left</span>
              <span className="tabular text-2xl font-bold normal-case tracking-normal text-ink">
                {phase === 'running'
                  ? timer.remaining.toFixed(1)
                  : phase === 'scoring'
                  ? '0.0'
                  : ROUND_SECONDS.toFixed(1)}
                s
              </span>
            </div>
            <Progress
              value={
                phase === 'running'
                  ? timerPct
                  : phase === 'scoring'
                  ? 100
                  : 0
              }
              tone="accent"
            />
          </div>

          <PhaseControls
            phase={phase}
            cameraStatus={camera.status}
            cameraError={camera.error}
            landmarkerStatus={landmarker.status}
            landmarkerError={landmarker.error}
            onRequestCamera={handleRequestCamera}
            onStart={handleStartRound}
          />

          {saveError ? (
            <p
              role="alert"
              className="border-2 border-destructive bg-destructive/10 p-3 font-mono text-[11px] text-destructive"
            >
              {saveError}
            </p>
          ) : null}

          {phase === 'running' || phase === 'scoring' || debugMode ? (
            <DebugOverlay
              latest={latestSample}
              framesSampled={debugCounts.total}
              framesWithFace={debugCounts.withFace}
              dev={debugMode}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: RoundPhase }) {
  const map: Record<RoundPhase, { label: string; tone: string }> = {
    permission: { label: 'Permission', tone: 'bg-paper text-ink' },
    ready: { label: 'Ready', tone: 'bg-paper text-ink' },
    countdown: { label: 'Countdown', tone: 'bg-accent text-accent-foreground' },
    running: {
      label: 'Live',
      tone: 'bg-accent text-accent-foreground animate-pulse-ink',
    },
    scoring: { label: 'Scoring', tone: 'bg-ink text-paper' },
  };
  const v = map[phase];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border-2 border-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-stamp',
        v.tone,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {v.label}
    </span>
  );
}

function RoundOverlay({
  phase,
  countdown,
  timerPct,
  remaining,
}: {
  phase: RoundPhase;
  countdown: number;
  timerPct: number;
  remaining: number;
}) {
  if (phase === 'countdown') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-ink/40">
        <span
          key={countdown}
          className="font-display text-[160px] leading-none text-paper animate-stamp-in"
          style={{ textShadow: '0 6px 0 hsl(var(--ink))' }}
        >
          {countdown}
        </span>
      </div>
    );
  }
  if (phase === 'running') {
    return (
      <>
        {/* Scan bar */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] origin-left bg-accent"
          style={{ width: `${timerPct}%`, transition: 'width 100ms linear' }}
        />
        {/* Live timer chip */}
        <div className="absolute left-3 top-3 inline-flex items-center gap-2 border-2 border-paper bg-ink/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-stamp text-paper">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-ink" />
          LIVE · {remaining.toFixed(1)}s
        </div>
      </>
    );
  }
  if (phase === 'scoring') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/60 text-paper">
        <Sparkles className="h-8 w-8 animate-pulse" />
        <span className="font-display text-3xl uppercase tracking-tight">
          Scanning
        </span>
        <span className="font-mono text-[10px] uppercase tracking-stamp opacity-80">
          Computing similarity…
        </span>
      </div>
    );
  }
  return null;
}

interface PhaseControlsProps {
  phase: RoundPhase;
  cameraStatus: ReturnType<typeof useCamera>['status'];
  cameraError: string | null;
  landmarkerStatus: ReturnType<typeof useFaceLandmarker>['status'];
  landmarkerError: string | null;
  onRequestCamera: () => void;
  onStart: () => void;
}

function PhaseControls({
  phase,
  cameraStatus,
  cameraError,
  landmarkerStatus,
  landmarkerError,
  onRequestCamera,
  onStart,
}: PhaseControlsProps) {
  if (phase === 'permission') {
    if (cameraStatus === 'denied' || cameraStatus === 'error') {
      return (
        <div className="flex flex-col gap-2 border-2 border-destructive bg-destructive/10 p-3">
          <p className="font-mono text-[10px] uppercase tracking-stamp text-destructive">
            Camera unavailable
          </p>
          <p className="text-sm text-destructive">{cameraError}</p>
          <Button variant="outline" className="w-full" onClick={onRequestCamera}>
            Try again
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          variant="accent"
          className="w-full"
          onClick={onRequestCamera}
          disabled={cameraStatus === 'requesting'}
        >
          {cameraStatus === 'requesting' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Requesting…
            </>
          ) : (
            'Allow camera'
          )}
        </Button>
        <p className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Frames are processed only on your device.
        </p>
        {landmarkerStatus === 'loading' && (
          <p className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
            Loading face model…
          </p>
        )}
        {landmarkerStatus === 'error' && (
          <p className="font-mono text-[10px] uppercase tracking-stamp text-destructive">
            Face model failed: {landmarkerError}
          </p>
        )}
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <Button size="lg" variant="accent" className="w-full" onClick={onStart}>
        <Play className="h-4 w-4" /> Start 10s round
      </Button>
    );
  }

  if (phase === 'countdown') {
    return (
      <Button size="lg" className="w-full" disabled>
        Get ready…
      </Button>
    );
  }

  if (phase === 'running') {
    return (
      <Button size="lg" variant="accent" className="w-full" disabled>
        <Sparkles className="h-4 w-4" /> Show that face!
      </Button>
    );
  }

  return (
    <Button size="lg" className="w-full" disabled>
      <Loader2 className="h-4 w-4 animate-spin" /> Scoring…
    </Button>
  );
}

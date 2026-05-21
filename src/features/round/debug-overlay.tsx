import type { FrameSample } from './types';
import { cn } from '@/lib/utils';

interface DebugOverlayProps {
  latest: FrameSample | null;
  framesSampled: number;
  framesWithFace: number;
  /** When true, show raw geometric values, pose, and detection rate. */
  dev?: boolean;
}

/**
 * Live readout of the trolling signals.
 *   wide   = lip-corner / face cheek width (geometric).
 *   smile  = min(mouthSmile blendshape, teethGap geometric ramp).
 *   brow   = eye-outer-corner → brow / face height (geometric, +15% max).
 *
 *   core    = wide × smile
 *   withBrow = core × (1 + 0.15 × brow)
 *   total   = min(1, sqrt(withBrow) × 0.9)
 *
 * Player mode (default): bars + frame score only.
 * Dev mode (`?debug=1`): adds raw values, detection counter, pose.
 */
export function DebugOverlay({
  latest,
  framesSampled,
  framesWithFace,
  dev = false,
}: DebugOverlayProps) {
  const effort = latest?.effort;
  const pose = latest?.pose;
  const detectionPct =
    framesSampled > 0
      ? Math.round((framesWithFace / framesSampled) * 100)
      : 0;

  return (
    <div className="ink-box flex flex-col gap-3 p-4 font-mono text-[11px] leading-snug">
      <div className="flex items-center justify-between border-b border-ink/30 pb-2 text-[10px] uppercase tracking-stamp text-muted-fg">
        <span>{dev ? 'Debug · Trolling effort' : 'Trolling effort'}</span>
        {dev ? (
          <span className="tabular">
            {framesWithFace}/{framesSampled} ({detectionPct}%)
          </span>
        ) : null}
      </div>

      {effort ? (
        <>
          <SubScoreBar
            label="Wide grin"
            value={effort.wide}
            rawLabel={
              dev ? `width ${effort.mouthWidthRatio.toFixed(2)}` : undefined
            }
          />
          <SubScoreBar
            label="Smile gate"
            value={effort.smileGate}
            rawLabel={
              dev ? `teeth gap ${effort.teethGapRatio.toFixed(3)}` : undefined
            }
            hint={
              effort.smileGate < 0.6
                ? '⚠ part lips — show teeth'
                : null
            }
          />
          <SubScoreBar
            label="Brow raise"
            value={effort.brow}
            rawLabel={
              dev ? `lift ${effort.browLiftRatio.toFixed(3)}` : undefined
            }
            hint={
              dev
                ? `+${Math.round(effort.brow * 15)}% bonus (capped at 100)`
                : null
            }
          />

          <div className="mt-1 flex items-center justify-between border-t border-ink/30 pt-2 text-[10px] uppercase tracking-stamp">
            <span className="text-muted-fg">Frame score</span>
            <span className="tabular text-xl font-bold text-ink">
              {Math.round(effort.total * 100)}
            </span>
          </div>
        </>
      ) : (
        <div className="py-2 text-center text-muted-fg">
          {framesSampled === 0 ? 'Awaiting first sample…' : 'No face detected'}
        </div>
      )}

      {dev && pose ? (
        <div className="flex items-center justify-between text-[10px] uppercase tracking-stamp">
          <span className="text-muted-fg">Pose</span>
          <span
            className={cn(
              'tabular',
              pose.ok ? 'text-ink' : 'text-destructive',
            )}
            title="pitch / yaw / roll, degrees"
          >
            {pose.pitchDeg.toFixed(0)}° / {pose.yawDeg.toFixed(0)}° /{' '}
            {pose.rollDeg.toFixed(0)}°
            {pose.ok ? '' : ' · off-axis'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SubScoreBar({
  label,
  value,
  rawLabel,
  hint,
}: {
  label: string;
  value: number;
  rawLabel?: string;
  hint?: string | null;
}) {
  return (
    <div className="grid grid-cols-[88px,1fr,40px] items-center gap-2">
      <span className="text-muted-fg">{label}</span>
      <div className="relative h-2 border border-ink bg-paper">
        <span
          aria-hidden
          className={cn(
            'absolute top-0 h-full transition-[width] duration-100 ease-out',
            value > 0.7
              ? 'bg-emerald-500'
              : value > 0.4
              ? 'bg-amber-400'
              : 'bg-accent',
          )}
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
      <span className="text-right tabular">{value.toFixed(2)}</span>
      {rawLabel ? (
        <span className="col-span-3 text-[9px] text-muted-fg/70">
          {rawLabel}
        </span>
      ) : null}
      {hint ? (
        <span
          className={cn(
            'col-span-3 text-[10px]',
            value < 0.4 ? 'text-destructive' : 'text-muted-fg',
          )}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useImageLandmarker } from '@/features/round/use-image-landmarker';
import {
  poseFromTransform,
  signalsFromBlendshapes,
} from '@/features/round/scoring';
import type { TrollSignals } from '@/features/round/types';
import { cn } from '@/lib/utils';

interface SampleResult {
  id: string;
  label: string;
  imageUrl: string;
  signals: TrollSignals | null;
  landmarks: { x: number; y: number; z: number }[] | null;
  pose: { pitchDeg: number; yawDeg: number; rollDeg: number; ok: boolean } | null;
  rawTopBlendshapes: { name: string; score: number }[] | null;
  error: string | null;
}

const BLENDSHAPE_LABELS: Record<keyof TrollSignals, string> = {
  mouthSmile: 'Smile (L+R avg)',
  mouthStretch: 'Stretch (L+R avg)',
  mouthPress: 'Press (L+R avg)',
  mouthUpperUp: 'Upper lip up (L+R)',
  mouthLowerDown: 'Lower lip down (L+R)',
  eyeSquint: 'Squint (L+R avg)',
  browDown: 'Brow ↓ (L+R avg)',
  browRaise: 'Brow ↑ outer (L+R)',
  jawOpen: 'Jaw open',
  cheekSquint: 'Cheek raise (L+R avg)',
};

export function CalibratePage() {
  const landmarker = useImageLandmarker();
  const [samples, setSamples] = useState<SampleResult[]>([]);
  const [autoRanCartoon, setAutoRanCartoon] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(
    async (file: File | string, label: string): Promise<SampleResult> => {
      const id = Math.random().toString(36).slice(2, 11);
      const imageUrl =
        typeof file === 'string' ? file : URL.createObjectURL(file);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image failed to load'));
      });

      const result = landmarker.detect(img);
      if (!result || !result.faceLandmarks?.length) {
        return {
          id,
          label,
          imageUrl,
          signals: null,
          landmarks: null,
          pose: null,
          rawTopBlendshapes: null,
          error: 'No face detected',
        };
      }
      const signals = signalsFromBlendshapes(result.faceBlendshapes?.[0]);
      const pose = poseFromTransform(
        result.facialTransformationMatrixes?.[0]?.data
          ? Array.from(result.facialTransformationMatrixes[0].data)
          : undefined,
      );
      const landmarks = result.faceLandmarks[0].map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
      }));
      const allBlendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
      const rawTopBlendshapes = [...allBlendshapes]
        .filter((c) => c.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map((c) => ({ name: c.categoryName, score: c.score }));

      return {
        id,
        label,
        imageUrl,
        signals,
        landmarks,
        pose,
        rawTopBlendshapes,
        error: null,
      };
    },
    [landmarker],
  );

  // Auto-load the default reference images exactly once when ready.
  useEffect(() => {
    if (autoRanCartoon || landmarker.status !== 'ready') return;
    setAutoRanCartoon(true);
    void (async () => {
      const cartoon = await processImage(
        '/trollface.png',
        'trollface.png (cartoon — expect fail)',
      );
      const human = await processImage(
        '/troll-reference.jpg',
        'troll-reference.jpg (human composite)',
      );
      setSamples((s) => [...s, cartoon, human]);
    })();
  }, [landmarker.status, autoRanCartoon, processImage]);

  const onUpload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const result = await processImage(file, file.name);
      setSamples((s) => [...s, result]);
    }
  };

  const removeSample = (id: string) =>
    setSamples((s) => s.filter((x) => x.id !== id));

  const validSamples = samples.filter((s) => s.signals && s.landmarks);

  const averaged = validSamples.length
    ? {
        signals: averageSignals(validSamples.map((s) => s.signals!)),
        landmarks: averageLandmarks(validSamples.map((s) => s.landmarks!)),
      }
    : null;

  const exportJson = averaged
    ? JSON.stringify(
        {
          sourceCount: validSamples.length,
          sources: validSamples.map((s) => s.label),
          signals: averaged.signals,
          landmarks: averaged.landmarks,
        },
        null,
        2,
      )
    : '';

  const copyExport = () => {
    if (!exportJson) return;
    navigator.clipboard.writeText(exportJson);
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          Dev tool · Reference extractor
        </span>
        <h1 className="font-display text-4xl uppercase leading-none sm:text-5xl">
          Calibrate
        </h1>
        <p className="text-sm text-muted-fg">
          Loads <code>/trollface.png</code> automatically. Drop selfies of real
          humans pulling the troll face to add more samples. The averaged
          reference is what gets baked into <code>scoring.ts</code>.
        </p>
      </header>

      {landmarker.status === 'loading' && (
        <div className="ink-box flex items-center gap-3 p-4 font-mono text-[11px]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading MediaPipe model…
        </div>
      )}
      {landmarker.status === 'error' && (
        <div className="ink-box flex items-center gap-3 border-destructive p-4 font-mono text-[11px] text-destructive">
          Model failed: {landmarker.error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
        <Button
          variant="accent"
          onClick={() => fileInputRef.current?.click()}
          disabled={landmarker.status !== 'ready'}
        >
          <Upload className="h-4 w-4" /> Add selfie images
        </Button>
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          {validSamples.length} valid · {samples.length} total
        </span>
      </div>

      {samples.length === 0 && landmarker.status === 'ready' ? (
        <div className="ink-box p-6 font-mono text-[11px] text-muted-fg">
          Awaiting first sample…
        </div>
      ) : null}

      <div className="grid gap-4">
        {samples.map((s) => (
          <SampleCard key={s.id} sample={s} onRemove={() => removeSample(s.id)} />
        ))}
      </div>

      {averaged ? (
        <div className="ink-box flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl uppercase leading-none">
              Averaged reference ({validSamples.length} samples)
            </h2>
            <Button variant="outline" size="sm" onClick={copyExport}>
              Copy JSON
            </Button>
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              Object.keys(BLENDSHAPE_LABELS) as (keyof TrollSignals)[]
            ).map((key) => (
              <li
                key={key}
                className="flex items-center justify-between border-2 border-ink bg-paper px-3 py-2 font-mono text-[11px]"
              >
                <span className="text-muted-fg">{BLENDSHAPE_LABELS[key]}</span>
                <span className="tabular font-bold">
                  {averaged.signals[key].toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
          <details className="font-mono text-[10px]">
            <summary className="cursor-pointer text-muted-fg">
              Full export JSON ({averaged.landmarks.length} landmarks)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto border-2 border-ink bg-paper p-3 text-[10px] leading-tight">
              {exportJson.slice(0, 2000)}
              {exportJson.length > 2000 ? '\n… (truncated, use Copy JSON)' : ''}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function SampleCard({
  sample,
  onRemove,
}: {
  sample: SampleResult;
  onRemove: () => void;
}) {
  return (
    <div className="ink-box flex flex-col gap-3 p-4 sm:flex-row">
      <div className="relative w-full shrink-0 sm:w-48">
        <img
          src={sample.imageUrl}
          alt={sample.label}
          className="aspect-square w-full object-cover"
        />
        {sample.landmarks ? (
          <LandmarkOverlay landmarks={sample.landmarks} />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-[11px] uppercase tracking-stamp text-ink">
            {sample.label}
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-ink/40 p-1 text-muted-fg hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {sample.error ? (
          <p className="font-mono text-[11px] text-destructive">
            ⚠ {sample.error}
          </p>
        ) : (
          <>
            {sample.signals ? (
              <SignalsList signals={sample.signals} />
            ) : null}

            {sample.pose ? (
              <p
                className={cn(
                  'font-mono text-[10px]',
                  sample.pose.ok ? 'text-muted-fg' : 'text-destructive',
                )}
              >
                pose pitch/yaw/roll: {sample.pose.pitchDeg.toFixed(0)}° /{' '}
                {sample.pose.yawDeg.toFixed(0)}° /{' '}
                {sample.pose.rollDeg.toFixed(0)}°{' '}
                {sample.pose.ok ? '✓' : '⚠ off-axis'}
              </p>
            ) : null}

            {sample.rawTopBlendshapes ? (
              <details className="font-mono text-[10px]">
                <summary className="cursor-pointer text-muted-fg">
                  Top 15 raw blendshapes (score &gt; 0.05)
                </summary>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                  {sample.rawTopBlendshapes.map((b) => (
                    <li
                      key={b.name}
                      className="flex justify-between border-b border-ink/20"
                    >
                      <span className="text-muted-fg">{b.name}</span>
                      <span className="tabular">{b.score.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function SignalsList({ signals }: { signals: TrollSignals }) {
  return (
    <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
      {(Object.keys(BLENDSHAPE_LABELS) as (keyof TrollSignals)[]).map((key) => (
        <li
          key={key}
          className="flex items-center justify-between border border-ink/40 px-2 py-1 font-mono text-[10px]"
        >
          <span className="text-muted-fg">
            {BLENDSHAPE_LABELS[key].split(' ')[0]}
          </span>
          <span className="tabular font-bold">{signals[key].toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

function LandmarkOverlay({
  landmarks,
}: {
  landmarks: { x: number; y: number; z: number }[];
}) {
  return (
    <svg
      viewBox="0 0 1 1"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
    >
      {landmarks.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="0.0025"
          fill="hsl(354 100% 60%)"
          opacity={0.6}
        />
      ))}
    </svg>
  );
}

function averageSignals(list: TrollSignals[]): TrollSignals {
  const keys: (keyof TrollSignals)[] = [
    'mouthSmile',
    'mouthStretch',
    'mouthPress',
    'mouthUpperUp',
    'mouthLowerDown',
    'eyeSquint',
    'browDown',
    'browRaise',
    'jawOpen',
    'cheekSquint',
  ];
  const acc = keys.reduce<TrollSignals>(
    (a, k) => ({ ...a, [k]: 0 }),
    {} as TrollSignals,
  );
  list.forEach((s) => keys.forEach((k) => (acc[k] += s[k])));
  keys.forEach((k) => (acc[k] /= list.length));
  return acc;
}

function averageLandmarks(
  list: { x: number; y: number; z: number }[][],
): { x: number; y: number; z: number }[] {
  const n = list[0].length;
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const lms of list) {
      x += lms[i].x;
      y += lms[i].y;
      z += lms[i].z;
    }
    out.push({
      x: x / list.length,
      y: y / list.length,
      z: z / list.length,
    });
  }
  return out;
}

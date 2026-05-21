import type {
  FaceLandmarkerResult,
  Classifications,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type {
  EffortBreakdown,
  FrameSample,
  PoseQuality,
  TrollSignals,
} from './types';
import { measuresFromLandmarks, type FaceMeasures } from './face-measures';

/**
 * Pull our 7 troll signals out of MediaPipe's 52-blendshape output.
 *
 * The blendshape categoryName values come from ARKit's canonical face
 * expression set, which MediaPipe's face_landmarker model is trained
 * against. Each is already a 0–1 weight calibrated by Google on a
 * large face dataset.
 *
 * Returns null if the expected blendshapes aren't present.
 */
export function signalsFromBlendshapes(
  blendshapes: Classifications | undefined,
): TrollSignals | null {
  if (!blendshapes?.categories?.length) return null;

  const byName = new Map<string, number>();
  for (const c of blendshapes.categories) {
    byName.set(c.categoryName, c.score);
  }
  const get = (name: string) => byName.get(name) ?? 0;
  const avg = (a: string, b: string) => (get(a) + get(b)) / 2;

  return {
    mouthSmile: avg('mouthSmileLeft', 'mouthSmileRight'),
    mouthStretch: avg('mouthStretchLeft', 'mouthStretchRight'),
    mouthPress: avg('mouthPressLeft', 'mouthPressRight'),
    mouthUpperUp: avg('mouthUpperUpLeft', 'mouthUpperUpRight'),
    mouthLowerDown: avg('mouthLowerDownLeft', 'mouthLowerDownRight'),
    eyeSquint: avg('eyeSquintLeft', 'eyeSquintRight'),
    browDown: avg('browDownLeft', 'browDownRight'),
    // Outer-brow only — inner brow fires on surprise even with no real
    // arching, which inflated the brow signal for normal expressions.
    browRaise: avg('browOuterUpLeft', 'browOuterUpRight'),
    jawOpen: get('jawOpen'),
    cheekSquint: avg('cheekSquintLeft', 'cheekSquintRight'),
  };
}

const MAX_OFF_AXIS_DEG = 25;

export function poseFromTransform(matrix: number[] | undefined): PoseQuality | null {
  if (!matrix || matrix.length < 16) return null;
  const m00 = matrix[0];
  const m10 = matrix[1];
  const m20 = matrix[2];
  const m21 = matrix[6];
  const m22 = matrix[10];

  const pitch = Math.atan2(-m21, m22);
  const yaw = Math.asin(Math.max(-1, Math.min(1, m20)));
  const roll = Math.atan2(-m10, m00);

  const toDeg = (r: number) => (r * 180) / Math.PI;
  const pitchDeg = toDeg(pitch);
  const yawDeg = toDeg(yaw);
  const rollDeg = toDeg(roll);

  const ok =
    Math.abs(pitchDeg) <= MAX_OFF_AXIS_DEG &&
    Math.abs(yawDeg) <= MAX_OFF_AXIS_DEG &&
    Math.abs(rollDeg) <= MAX_OFF_AXIS_DEG;

  return { pitchDeg, yawDeg, rollDeg, ok };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Calibration thresholds. The width and openness ramps deliberately
 * require an EXTREME grin to max out — the trollface is supposed to be
 * "humanly impossible" wide, so we shouldn't be giving 100s easily.
 *
 * Measured reference: the human-trollface composite photo has
 * mouthWidthRatio ≈ 0.44 (computed from its landmarks). With our ramp
 * starting credit at 0.32 and full at 0.55, that reference scores
 * wide ≈ 0.52, raised to ^1.4 ≈ 0.40 — so even the reference image
 * doesn't hit 100. You have to push WIDER than the reference to max out.
 */
const RAMP = {
  /** Start gaining width credit above this ratio. ~ relaxed mouth. */
  mouthWidthStart: 0.32,
  /** Full width credit at this ratio. Trollface territory. */
  mouthWidthFull: 0.56,

  /**
   * Smile gate combines TWO signals via min() so both must be high:
   *   1. smileDir — corners pulled UP (mouthSmile blendshape, sanity check)
   *   2. teethShow — lips actually parted vertically (landmark gap)
   *
   * The teethGap measurement is GEOMETRIC — can't lie. Ramp 0.02→0.055
   * means lips have to physically separate at least 5.5% of face height
   * to fully clear the teeth half of the gate.
   */
  smileDirFull: 0.7,
  smileDirPower: 1.5,
  teethGapStart: 0.02,
  teethGapFull: 0.055,
  teethGapPower: 1.4,

  /**
   * Power applied to the width score. > 1 makes it harder to max out.
   */
  widePower: 1.4,

  /**
   * Brow lift = distance from eye OUTER CORNER (orbital bone, stable
   * during grins/squints) to averaged brow position / face height.
   *
   * Threshold values are face-anatomy dependent. These are starter
   * defaults — wide enough that most faces can score something with
   * effort, conservative enough that a relaxed face stays at 0. If your
   * raw `lift` value at rest is X and at max effort is Y, set
   * browLiftStart ≈ X + 0.01 and browLiftFull ≈ Y to match exactly.
   */
  browLiftStart: 0.1,
  browLiftFull: 0.18,
  browPower: 1.2,
  /** Max multiplicative boost from a fully-raised brow. +15% capped at 1.0. */
  browBoostMax: 0.15,

  /**
   * Final-score curve. We want:
   *   - a solid trollface attempt to land around 80
   *   - a maxed-out grin (no brow) to land at 90
   *   - 90→100 to be the "fight zone" reserved for max grin + brow bonus
   *
   * Implementation: gamma-compress the raw core with a sqrt (power 0.5),
   * then scale to 0.9. The brow bonus is applied multiplicatively BEFORE
   * the curve, so a maxed grin + full brow can push past 0.9 toward 1.0.
   *
   *   total = min(1, sqrt(core × (1 + 0.15 × brow)) × 0.9)
   *
   * Numbers (no brow): core 0.50 → 64, 0.70 → 75, 0.85 → 83, 1.00 → 90.
   * With full brow: 1.00 → 96.
   */
  finalPower: 0.5,
  finalScale: 0.9,
} as const;

/**
 * Score a single frame.
 *
 * Two signals carry the score, plus a bonus:
 *
 *   1. WIDE GRIN (primary, geometric).
 *      mouthWidthRatio = lip-corner distance / face cheek width.
 *      Ramp 0.32 → 0.56, raised to ^1.4 so mid-range gets discounted.
 *
 *   2. SMILE GATE (real teeth-baring grin, geometric + blendshape).
 *      min(mouthSmile blendshape ramp, teethGapRatio ramp). Both must
 *      be high: lips parted enough to show teeth AND corners turned up.
 *
 *   3. BROW RAISE (geometric bonus).
 *      Distance from eye OUTER CORNER (stable orbital-bone anchor) to
 *      averaged brow position / face height. Ramp 0.10 → 0.18.
 *      Up to +15% multiplicative boost — only matters if a grin score
 *      already exists.
 *
 *   core    = wide × smileGate
 *   withBrow = core × (1 + 0.15 × brow)
 *   total   = min(1, sqrt(withBrow) × 0.9)
 *
 * The sqrt curve lifts the mid-range so a solid attempt feels rewarding
 * (~80), and the ×0.9 puts a soft ceiling at 90 for "max grin, no brow"
 * — only the brow bonus pushes you into the 90–100 fight zone.
 *
 * Eye narrowing was removed: it was binary (flipped 0/1 on tiny moves)
 * and the trollface's narrowed eyes are implicit in the smile gate
 * via cheek-raise.
 */
export function trollingEffort(
  signals: TrollSignals,
  measuresOrLandmarks?:
    | FaceMeasures
    | NormalizedLandmark[]
    | null
    | undefined,
): EffortBreakdown {
  const measures = isFaceMeasures(measuresOrLandmarks)
    ? measuresOrLandmarks
    : measuresFromLandmarks(measuresOrLandmarks as NormalizedLandmark[]);

  const mouthWidthRatio = measures?.mouthWidthRatio ?? 0;
  const browLiftRatio = measures?.browLiftRatio ?? 0;
  const teethGapRatio = measures?.teethGapRatio ?? 0;

  // Wide grin — same as before, geometric width / face ratio.
  const widthBase = clamp01(
    (mouthWidthRatio - RAMP.mouthWidthStart) /
      (RAMP.mouthWidthFull - RAMP.mouthWidthStart),
  );
  const wide = Math.pow(widthBase, RAMP.widePower);

  // Smile gate: min() of two signals, both must be high.
  //   1. mouthSmile blendshape — confirms corners up (smile direction)
  //   2. teethGapRatio — GEOMETRIC measurement of lip separation
  //
  // The teeth signal can't be saturated by ML — it's a literal distance
  // measurement. You have to physically open your mouth wide for it to
  // fill. Closed-lip smile = no teeth gap = gate stays low.
  const smileDir = Math.pow(
    clamp01(signals.mouthSmile / RAMP.smileDirFull),
    RAMP.smileDirPower,
  );
  const teethBase = clamp01(
    (teethGapRatio - RAMP.teethGapStart) /
      (RAMP.teethGapFull - RAMP.teethGapStart),
  );
  const teethShow = Math.pow(teethBase, RAMP.teethGapPower);
  const smileGate = Math.min(smileDir, teethShow);

  // Brow — GEOMETRIC measurement of eye-outer-corner-to-brow distance
  // / face height. Can't be ML-saturated. Has to physically lift the
  // brow muscles to widen the gap. Ramp tuned in RAMP.browLiftStart/Full.
  const browBase = clamp01(
    (browLiftRatio - RAMP.browLiftStart) /
      (RAMP.browLiftFull - RAMP.browLiftStart),
  );
  const brow = Math.pow(browBase, RAMP.browPower);

  const core = wide * smileGate;
  const withBrow = core * (1 + RAMP.browBoostMax * brow);
  const total = Math.min(
    1,
    Math.pow(withBrow, RAMP.finalPower) * RAMP.finalScale,
  );

  return {
    mouthWidthRatio,
    browLiftRatio,
    teethGapRatio,
    wide,
    smileGate,
    brow,
    total,
  };
}

function isFaceMeasures(x: unknown): x is FaceMeasures {
  return (
    !!x &&
    typeof x === 'object' &&
    'mouthWidthRatio' in x &&
    'eyeOpennessRatio' in x
  );
}

/**
 * Convenience: pull signals + pose + effort breakdown out of a single
 * MediaPipe detection result.
 */
export function frameFromDetection(
  result: FaceLandmarkerResult | null,
  timestamp: number,
): FrameSample {
  if (!result || !result.faceLandmarks?.length) {
    return {
      timestamp,
      detected: false,
      signals: null,
      pose: null,
      effort: null,
    };
  }
  const signals = signalsFromBlendshapes(result.faceBlendshapes?.[0]);
  const pose = poseFromTransform(
    result.facialTransformationMatrixes?.[0]?.data
      ? Array.from(result.facialTransformationMatrixes[0].data)
      : undefined,
  );
  const landmarks = result.faceLandmarks[0];
  const effort = signals ? trollingEffort(signals, landmarks) : null;
  return {
    timestamp,
    detected: signals != null && effort != null,
    signals,
    pose,
    effort,
  };
}

export interface RoundScoreInput {
  samples: FrameSample[];
  minDetectionRate?: number;
}

export interface RoundScoreOutput {
  score: number;
  detectionRate: number;
  framesSampled: number;
  framesWithFace: number;
  avgSignals: TrollSignals | null;
  reason?: 'no-face' | 'low-detection';
}

const DEFAULT_MIN_DETECTION_RATE = 0.7;

/**
 * Aggregate frame samples into a 0–100 round score.
 *
 * - Frames with bad head pose are dropped from scoring (but still count
 *   toward detection rate so the player can't game it by turning away).
 * - If detection rate < min, returns 0 with reason 'low-detection'.
 * - Score is the 80th-percentile per-frame effort — rewards the player's
 *   best stretch without a one-frame fluke pinning the score.
 */
export function scoreRound({
  samples,
  minDetectionRate = DEFAULT_MIN_DETECTION_RATE,
}: RoundScoreInput): RoundScoreOutput {
  const framesSampled = samples.length;
  const detected = samples.filter((s) => s.detected && s.signals);
  const framesWithFace = detected.length;
  const detectionRate =
    framesSampled > 0 ? framesWithFace / framesSampled : 0;

  if (framesSampled === 0 || framesWithFace === 0) {
    return {
      score: 0,
      detectionRate: 0,
      framesSampled,
      framesWithFace,
      avgSignals: null,
      reason: 'no-face',
    };
  }

  if (detectionRate < minDetectionRate) {
    return {
      score: 0,
      detectionRate,
      framesSampled,
      framesWithFace,
      avgSignals: averageSignals(detected),
      reason: 'low-detection',
    };
  }

  const inPose = detected.filter((s) => s.pose?.ok !== false);
  const scoringPool = inPose.length > 0 ? inPose : detected;

  const efforts = scoringPool
    .map((s) => (s.effort ?? trollingEffort(s.signals as TrollSignals)).total)
    .sort((a, b) => a - b);
  const idx = Math.floor(efforts.length * 0.8);
  const best = efforts[Math.min(idx, efforts.length - 1)];

  return {
    score: Math.round(best * 100),
    detectionRate,
    framesSampled,
    framesWithFace,
    avgSignals: averageSignals(detected),
  };
}

export function averageSignals(samples: FrameSample[]): TrollSignals | null {
  const valid = samples
    .map((s) => s.signals)
    .filter((s): s is TrollSignals => s != null);
  if (valid.length === 0) return null;
  const keys: (keyof TrollSignals)[] = [
    'mouthSmile',
    'mouthStretch',
    'mouthPress',
    'eyeSquint',
    'browDown',
    'jawOpen',
    'cheekSquint',
  ];
  const acc = keys.reduce<TrollSignals>(
    (a, k) => {
      a[k] = 0;
      return a;
    },
    {} as TrollSignals,
  );
  valid.forEach((s) => keys.forEach((k) => (acc[k] += s[k])));
  keys.forEach((k) => (acc[k] /= valid.length));
  return acc;
}

export function pointsForScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

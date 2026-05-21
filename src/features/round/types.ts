/**
 * Subset of the 52 MediaPipe / ARKit blendshape weights we care about
 * for scoring a troll face. Each is a normalized 0–1 weight Google's model
 * outputs per frame. Names match the canonical ARKit blendshape names.
 */
export interface TrollSignals {
  /** Lip-corner pull up & out — the smile direction. */
  mouthSmile: number;
  /** Lip-corner stretch horizontally. */
  mouthStretch: number;
  /** Lips pressed together thinly. */
  mouthPress: number;
  /**
   * Upper lip raised, exposing upper teeth. (mouthUpperUpL+R avg.)
   * Specific "teeth showing on top" signal — much harder to trigger
   * than mouthSmile and key to the trollface gate.
   */
  mouthUpperUp: number;
  /**
   * Lower lip pulled down, exposing lower teeth. (mouthLowerDownL+R avg.)
   * Specific "teeth showing on bottom" signal.
   */
  mouthLowerDown: number;
  /** Eyes squinted shut. */
  eyeSquint: number;
  /** Inner brows pulled down (slight furrow). */
  browDown: number;
  /**
   * Outer-brow raise — averaged from browOuterUpLeft + browOuterUpRight.
   * The "smug arch" trollface marker. Dropped browInnerUp because it
   * fires too easily on surprise reflexes.
   */
  browRaise: number;
  /** Jaw open. */
  jawOpen: number;
  /** Cheek raise from a real grin (Duchenne marker). */
  cheekSquint: number;
}

/** Sub-scores that make up a frame's trolling effort, for debugging. */
export interface EffortBreakdown {
  /** Raw mouth corner-to-corner / face cheek width. ~0.30 relaxed, ~0.56 troll. */
  mouthWidthRatio: number;
  /** Raw eye-outer-corner → brow / faceheight. ~0.10 relaxed, ~0.18 arch. */
  browLiftRatio: number;
  /** Raw lower-upper inner lip gap / faceheight. ~0.005 closed, ~0.055 teeth. */
  teethGapRatio: number;

  /** Normalised 0–1 wide-grin score. */
  wide: number;
  /**
   * Smile gate 0–1. min(mouthSmile direction, teethGapRatio). Both must
   * be high — wide-but-closed-lips fails, open-but-no-smile fails.
   */
  smileGate: number;
  /**
   * Brow score 0–1 from landmark-based brow lift (not blendshape).
   * Pure bonus, can't drag the total down.
   */
  brow: number;
  /** Final 0–1 score: min(1, sqrt(wide × smileGate × (1 + 0.15×brow)) × 0.9). */
  total: number;
}

export interface PoseQuality {
  /** Approximate pitch in degrees (head nodding up/down). 0 = looking straight. */
  pitchDeg: number;
  /** Approximate yaw in degrees (head turning left/right). */
  yawDeg: number;
  /** Approximate roll in degrees (head tilted sideways). */
  rollDeg: number;
  /** True if pose is close enough to camera-facing to score reliably. */
  ok: boolean;
}

export interface FrameSample {
  timestamp: number;
  detected: boolean;
  signals: TrollSignals | null;
  pose: PoseQuality | null;
  /** Per-frame effort breakdown for the debug overlay. */
  effort: EffortBreakdown | null;
}

export type RoundPhase =
  | 'permission'
  | 'ready'
  | 'countdown'
  | 'running'
  | 'scoring';

export interface RoundResult {
  id: string;
  playerId: string;
  playerName: string;
  score: number;
  pointsAwarded: number;
  detectionRate: number;
  createdAt: number;
  meta: {
    framesSampled: number;
    framesWithFace: number;
    avgSignals?: TrollSignals;
  };
}

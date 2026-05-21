import { describe, expect, it } from 'vitest';
import {
  pointsForScore,
  poseFromTransform,
  scoreRound,
  signalsFromBlendshapes,
  trollingEffort,
} from './scoring';
import type { FaceMeasures } from './face-measures';
import type {
  FrameSample,
  PoseQuality,
  TrollSignals,
} from './types';

const okPose: PoseQuality = { pitchDeg: 0, yawDeg: 0, rollDeg: 0, ok: true };

const blendshapesNeutral: TrollSignals = {
  mouthSmile: 0.05,
  mouthStretch: 0.04,
  mouthPress: 0.05,
  mouthUpperUp: 0.02,
  mouthLowerDown: 0.02,
  eyeSquint: 0.05,
  browDown: 0.05,
  browRaise: 0.0,
  jawOpen: 0.05,
  cheekSquint: 0.02,
};

// "Smiling with full teeth showing" — what a real trollface attempt
// has on the blendshapes side.
const blendshapesSmiling: TrollSignals = {
  ...blendshapesNeutral,
  mouthSmile: 0.92,
  mouthUpperUp: 0.55,
  mouthLowerDown: 0.5,
};

/**
 * Helper to build a synthesised frame from face measurements + a
 * blendshape vector. Use this in tests instead of building 478 fake
 * landmarks — trollingEffort accepts the measurements directly.
 */
const synth = (
  measures: FaceMeasures,
  blendshapes: TrollSignals = blendshapesSmiling,
  timestamp = 0,
): FrameSample => {
  const effort = trollingEffort(blendshapes, measures);
  return {
    detected: true,
    signals: blendshapes,
    timestamp,
    pose: okPose,
    effort,
  };
};

// === Measurement vectors (what MediaPipe would actually produce) ===

// Brow lift values reflect the new eye-outer-corner reference (larger
// scale than eye-top — resting ~0.18-0.22, max ~0.30-0.35).

/** Resting closed face. */
const NEUTRAL: FaceMeasures = {
  mouthWidthRatio: 0.31,
  eyeOpennessRatio: 0.36,
  browLiftRatio: 0.19,
  teethGapRatio: 0.005,
};

/** Normal-person CLOSED-LIP smile. No teeth visible. */
const NORMAL_SMILE: FaceMeasures = {
  mouthWidthRatio: 0.39,
  eyeOpennessRatio: 0.33,
  browLiftRatio: 0.19,
  teethGapRatio: 0.008,
};

/** Big honest smile — some teeth visible but not extreme. */
const BIG_SMILE: FaceMeasures = {
  mouthWidthRatio: 0.46,
  eyeOpennessRatio: 0.28,
  browLiftRatio: 0.2,
  teethGapRatio: 0.025,
};

/** A real troll attempt — wide grin with clear teeth, mild brow arch. */
const TROLL_GOOD: FaceMeasures = {
  mouthWidthRatio: 0.5,
  eyeOpennessRatio: 0.28,
  browLiftRatio: 0.24,
  teethGapRatio: 0.04,
};

/** Maximum trolling — extreme width, extreme teeth, extreme brow arch. */
const TROLL_EXTREME: FaceMeasures = {
  mouthWidthRatio: 0.6,
  eyeOpennessRatio: 0.22,
  browLiftRatio: 0.34,
  teethGapRatio: 0.06,
};

/** Wide open mouth — a yawn or scream. */
const SURPRISED: FaceMeasures = {
  mouthWidthRatio: 0.4,
  eyeOpennessRatio: 0.4,
  browLiftRatio: 0.26,
  teethGapRatio: 0.1,
};

const score = (measures: FaceMeasures, blendshapes = blendshapesSmiling) =>
  Math.round(trollingEffort(blendshapes, measures).total * 100);

describe('trollingEffort', () => {
  it('scores a resting face very low', () => {
    expect(score(NEUTRAL, blendshapesNeutral)).toBeLessThan(5);
  });

  it('scores a closed-lip "normal smile" near zero (no teeth = no gate)', () => {
    expect(score(NORMAL_SMILE)).toBeLessThan(5);
  });

  it('scores a big-with-some-teeth smile low (teeth gap not enough)', () => {
    expect(score(BIG_SMILE)).toBeLessThan(25);
  });

  it('scores a real troll attempt in the moderate range', () => {
    const s = score(TROLL_GOOD);
    expect(s).toBeGreaterThan(20);
    expect(s).toBeLessThan(80);
  });

  it('scores an extreme trolling attempt very high', () => {
    expect(score(TROLL_EXTREME)).toBeGreaterThan(85);
  });

  it('kills the score when the smile gate fails (open mouth, no smile)', () => {
    // Wide mouth but mouthSmile blendshape is low → it's a yawn, not a grin
    const yawnyBlendshapes: TrollSignals = {
      ...blendshapesNeutral,
      mouthSmile: 0.05,
    };
    const s = score(SURPRISED, yawnyBlendshapes);
    expect(s).toBeLessThan(10);
  });

  it('ranks expressions in the expected order', () => {
    expect(score(TROLL_EXTREME)).toBeGreaterThan(score(TROLL_GOOD));
    expect(score(TROLL_GOOD)).toBeGreaterThan(score(BIG_SMILE));
    expect(score(BIG_SMILE)).toBeGreaterThanOrEqual(score(NORMAL_SMILE));
    expect(score(NORMAL_SMILE)).toBeGreaterThanOrEqual(
      score(NEUTRAL, blendshapesNeutral),
    );
  });

  it('brow bonus only applies on top of a score that already exists', () => {
    // Just raising your eyebrows on a NEUTRAL face shouldn't score
    // anything — the brow is a bonus modifier, not a primary signal.
    const browAlone: FaceMeasures = {
      ...NEUTRAL,
      browLiftRatio: 0.13, // extreme arch
    };
    expect(score(browAlone, blendshapesNeutral)).toBeLessThan(5);
  });

  it('teeth-gap signal is geometric — lips parted ⇒ gate opens', () => {
    // Same wide-grin width, same blendshape direction, just changing
    // the lip separation. Tightly-closed lips → gate closed.
    // Lips parted to show teeth → gate opens.
    const closedLips: FaceMeasures = {
      ...TROLL_GOOD,
      teethGapRatio: 0.005, // closed
    };
    const partedLips: FaceMeasures = {
      ...TROLL_GOOD,
      teethGapRatio: 0.06, // teeth showing
    };
    expect(score(closedLips)).toBeLessThan(5);
    expect(score(partedLips)).toBeGreaterThan(score(closedLips) + 30);
  });

  it('brow signal is geometric — landmark brow lift drives the bonus', () => {
    const flatBrows: FaceMeasures = {
      ...TROLL_GOOD,
      browLiftRatio: 0.08, // below ramp start (0.10)
    };
    const archedBrows: FaceMeasures = {
      ...TROLL_GOOD,
      browLiftRatio: 0.13, // mid-ramp
    };
    const flat = trollingEffort(blendshapesSmiling, flatBrows);
    const arched = trollingEffort(blendshapesSmiling, archedBrows);
    expect(arched.brow).toBeGreaterThan(flat.brow);
    expect(arched.total).toBeGreaterThan(flat.total);
  });

  it('brow bonus is capped — already-100 stays at 100', () => {
    const maxedWithExtraBrow: FaceMeasures = {
      ...TROLL_EXTREME,
      browLiftRatio: 0.16, // way past full
    };
    const arched = trollingEffort(
      blendshapesSmiling,
      maxedWithExtraBrow,
    ).total;
    expect(arched).toBeLessThanOrEqual(1.0);
  });

  it('the width^1.4 difficulty curve punishes mid-range width', () => {
    const borderline: FaceMeasures = {
      mouthWidthRatio: 0.44, // midway through the ramp (~0.52 raw width)
      eyeOpennessRatio: 0.28,
      browLiftRatio: 0.07,
      teethGapRatio: 0.04,
    };
    const e = trollingEffort(blendshapesSmiling, borderline);
    expect(e.wide).toBeLessThan(0.55); // pre-power was 0.52, after ^1.4
  });

  it('exposes raw geometric ratios for the debug overlay', () => {
    const e = trollingEffort(blendshapesSmiling, TROLL_GOOD);
    expect(e.mouthWidthRatio).toBe(TROLL_GOOD.mouthWidthRatio);
    expect(e.browLiftRatio).toBe(TROLL_GOOD.browLiftRatio);
    expect(e.teethGapRatio).toBe(TROLL_GOOD.teethGapRatio);
  });
});

describe('signalsFromBlendshapes', () => {
  it('averages left/right pairs and reads single-sided signals', () => {
    const fakeBlendshapes = {
      categories: [
        { categoryName: 'mouthSmileLeft', score: 0.8, index: 0, displayName: '' },
        { categoryName: 'mouthSmileRight', score: 0.6, index: 0, displayName: '' },
        { categoryName: 'jawOpen', score: 0.1, index: 0, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    };
    const sig = signalsFromBlendshapes(fakeBlendshapes);
    expect(sig?.mouthSmile).toBeCloseTo(0.7, 5);
    expect(sig?.jawOpen).toBeCloseTo(0.1, 5);
    expect(sig?.eyeSquint).toBe(0);
  });

  it('returns null when no blendshapes are present', () => {
    expect(signalsFromBlendshapes(undefined)).toBeNull();
  });
});

describe('poseFromTransform', () => {
  it('returns ok=true for an identity matrix (camera-facing)', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const p = poseFromTransform(identity);
    expect(p?.ok).toBe(true);
    expect(Math.abs(p?.pitchDeg ?? 99)).toBeLessThan(1);
  });

  it('rejects a head turned 45° to the side', () => {
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    const rotY = [
      cos, 0, -sin, 0,
      0,   1, 0,    0,
      sin, 0, cos,  0,
      0,   0, 0,    1,
    ];
    const p = poseFromTransform(rotY);
    expect(p?.ok).toBe(false);
    expect(Math.abs(p?.yawDeg ?? 0)).toBeGreaterThan(40);
  });
});

describe('scoreRound', () => {
  const noFace = (i: number): FrameSample => ({
    detected: false,
    signals: null,
    timestamp: i,
    pose: null,
    effort: null,
  });

  it('returns 0 with reason "no-face" when nothing was detected', () => {
    const result = scoreRound({
      samples: Array.from({ length: 10 }, (_, i) => noFace(i)),
    });
    expect(result.score).toBe(0);
    expect(result.reason).toBe('no-face');
  });

  it('returns 0 with reason "low-detection" below threshold', () => {
    const samples: FrameSample[] = [
      ...Array.from({ length: 4 }, (_, i) => synth(TROLL_EXTREME, blendshapesSmiling, i)),
      ...Array.from({ length: 6 }, (_, i) => noFace(4 + i)),
    ];
    const result = scoreRound({ samples });
    expect(result.score).toBe(0);
    expect(result.reason).toBe('low-detection');
  });

  it('produces a 90+ score when most frames are an extreme troll', () => {
    const samples: FrameSample[] = Array.from({ length: 10 }, (_, i) =>
      synth(TROLL_EXTREME, blendshapesSmiling, i),
    );
    const result = scoreRound({ samples });
    expect(result.score).toBeGreaterThan(90);
    expect(result.detectionRate).toBe(1);
  });

  it('gives a neutral 10-second hold a near-zero score', () => {
    const samples: FrameSample[] = Array.from({ length: 10 }, (_, i) =>
      synth(NEUTRAL, blendshapesNeutral, i),
    );
    expect(scoreRound({ samples }).score).toBeLessThan(5);
  });
});

describe('pointsForScore', () => {
  it('clamps values to 0–100 and rounds', () => {
    expect(pointsForScore(72.4)).toBe(72);
    expect(pointsForScore(-3)).toBe(0);
    expect(pointsForScore(120)).toBe(100);
  });
});

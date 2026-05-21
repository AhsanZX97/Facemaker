import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * MediaPipe canonical face mesh indices we need for direct geometric
 * measurement of mouth width and eye openness.
 *
 * Source: canonical_face_model_uv_visualization.png in the MediaPipe repo.
 */
const IDX = {
  // Mouth corners (outer)
  mouthLeftCorner: 61,
  mouthRightCorner: 291,

  // Inner lip edges — for measuring teeth-showing gap (vertical
  // distance between upper and lower lip interiors).
  upperLipInner: 13,
  lowerLipInner: 14,

  // Face boundary at cheekbone height — for normalising mouth width.
  faceLeft: 234,
  faceRight: 454,

  // Vertical face span — for normalising brow lift and teeth gap.
  faceTop: 10,
  faceBottom: 152,

  // Eyes — top/bottom of eyelid mid + outer/inner corners.
  leftEyeTop: 159,
  leftEyeBottom: 145,
  leftEyeOuter: 33,
  leftEyeInner: 133,

  rightEyeTop: 386,
  rightEyeBottom: 374,
  rightEyeInner: 362,
  rightEyeOuter: 263,

  // Brow points used for the brow-lift average. 3 per side spanning the
  // top edge, middle, and bottom edge of the brow ridge. Averaging them
  // makes the measurement robust to landmark jitter and reduces the
  // chance any one slightly-mis-positioned landmark dominates.
  //
  // Anatomical RIGHT brow (image left when person faces camera):
  rightBrowTop: 52,    // upper edge mid
  rightBrowMid: 65,    // middle-mid
  rightBrowBot: 105,   // lower edge mid (closest to eye)
  // Anatomical LEFT brow (image right):
  leftBrowTop: 282,
  leftBrowMid: 295,
  leftBrowBot: 334,
} as const;

interface Pt {
  x: number;
  y: number;
}

function dist(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface FaceMeasures {
  /**
   * Mouth corner-to-corner distance divided by face cheek-to-cheek
   * distance. Normal mouth: ~0.30. Big smile: ~0.40. Wide grin: ~0.45+.
   * Trollface-territory: 0.55+.
   */
  mouthWidthRatio: number;

  /**
   * Average of (eyelid open height / eye corner-to-corner width) across
   * both eyes. Fully-open eyes: ~0.35. Narrowed: ~0.20. Squinted shut:
   * ~0.08. Lower = more closed.
   */
  eyeOpennessRatio: number;

  /**
   * Vertical distance from eye-top to brow-inner divided by face height.
   * GEOMETRIC measurement of brow raise — can't be faked by ML
   * saturation. Relaxed: ~0.06-0.07. Raised: ~0.09. Strong arch: ~0.11+.
   * Extreme (eyebrows-on-forehead): ~0.13+.
   */
  browLiftRatio: number;

  /**
   * Vertical distance between inner upper lip and inner lower lip,
   * divided by face height. GEOMETRIC "lips parted to show teeth"
   * measurement. Lips closed: ~0.005. Slightly parted: ~0.02.
   * Showing teeth: ~0.04+. Lots of teeth (incl. molars): ~0.06+.
   */
  teethGapRatio: number;
}

/**
 * Compute mouth-width and eye-openness ratios straight from the 478
 * landmarks. This bypasses MediaPipe's blendshape abstractions for
 * signals where we want literal geometric truth (how wide IS the mouth?
 * how narrow ARE the eyes?). Blendshapes are still useful as semantic
 * sanity checks elsewhere (e.g. mouthSmile to confirm corners go UP).
 */
export function measuresFromLandmarks(
  landmarks: NormalizedLandmark[] | null | undefined,
): FaceMeasures | null {
  if (!landmarks || landmarks.length < 468) return null;

  const ml = landmarks[IDX.mouthLeftCorner];
  const mr = landmarks[IDX.mouthRightCorner];
  const fl = landmarks[IDX.faceLeft];
  const fr = landmarks[IDX.faceRight];
  if (!ml || !mr || !fl || !fr) return null;

  const mouthWidth = dist(ml, mr);
  const faceWidth = dist(fl, fr);
  if (faceWidth < 1e-6) return null;
  const mouthWidthRatio = mouthWidth / faceWidth;

  const lT = landmarks[IDX.leftEyeTop];
  const lB = landmarks[IDX.leftEyeBottom];
  const lO = landmarks[IDX.leftEyeOuter];
  const lI = landmarks[IDX.leftEyeInner];
  const rT = landmarks[IDX.rightEyeTop];
  const rB = landmarks[IDX.rightEyeBottom];
  const rI = landmarks[IDX.rightEyeInner];
  const rO = landmarks[IDX.rightEyeOuter];
  if (!lT || !lB || !lO || !lI || !rT || !rB || !rI || !rO) return null;

  const lH = dist(lT, lB);
  const lW = dist(lO, lI);
  const rH = dist(rT, rB);
  const rW = dist(rO, rI);
  const leftOpenness = lW > 1e-6 ? lH / lW : 0;
  const rightOpenness = rW > 1e-6 ? rH / rW : 0;
  const eyeOpennessRatio = (leftOpenness + rightOpenness) / 2;

  // Vertical face span — normaliser for brow-lift and teeth-gap so that
  // distance from camera doesn't affect the ratio.
  const faceTop = landmarks[IDX.faceTop];
  const faceBottom = landmarks[IDX.faceBottom];
  if (!faceTop || !faceBottom) return null;
  const faceHeight = Math.abs(faceBottom.y - faceTop.y);
  if (faceHeight < 1e-6) return null;

  // Brow lift: distance from each eye's OUTER CORNER to the average of
  // 3 brow landmarks on the same side, divided by face height.
  //
  // CRITICAL: we use the eye OUTER CORNER (33 right / 263 left), NOT the
  // eye top (159/386). The outer corners are anchored to the orbital
  // bone, so they don't move when you grin (cheeks push up the eye top
  // and the lower eyelid, but the corners stay put). Using eye-top
  // caused the brow score to DROP during a hard grin because cheek
  // raise pushed the eye-top landmark up, closing the gap to the brow.
  //
  // Pair each eye with the brow on the SAME anatomical side:
  //   - right (159 family, anatomical right) paired with right brow
  //   - left (386 family, anatomical left) paired with left brow
  const rEyeOuter = landmarks[33];
  const lEyeOuter = landmarks[263];
  const rBrowTop = landmarks[IDX.rightBrowTop];
  const rBrowMid = landmarks[IDX.rightBrowMid];
  const rBrowBot = landmarks[IDX.rightBrowBot];
  const lBrowTop = landmarks[IDX.leftBrowTop];
  const lBrowMid = landmarks[IDX.leftBrowMid];
  const lBrowBot = landmarks[IDX.leftBrowBot];
  if (
    !rEyeOuter ||
    !lEyeOuter ||
    !rBrowTop || !rBrowMid || !rBrowBot ||
    !lBrowTop || !lBrowMid || !lBrowBot
  ) {
    return null;
  }

  const rBrowAvgY = (rBrowTop.y + rBrowMid.y + rBrowBot.y) / 3;
  const lBrowAvgY = (lBrowTop.y + lBrowMid.y + lBrowBot.y) / 3;

  const rightSideLift = rEyeOuter.y - rBrowAvgY;
  const leftSideLift = lEyeOuter.y - lBrowAvgY;
  // Clamp negative — would mean brow below eye (bad detection).
  const browLiftAvg =
    (Math.max(0, leftSideLift) + Math.max(0, rightSideLift)) / 2;
  const browLiftRatio = browLiftAvg / faceHeight;

  // Teeth gap: vertical distance between inner upper and inner lower
  // lip landmarks. When mouth is parted, this widens.
  const upLip = landmarks[IDX.upperLipInner];
  const loLip = landmarks[IDX.lowerLipInner];
  if (!upLip || !loLip) return null;
  const teethGapRatio = Math.abs(loLip.y - upLip.y) / faceHeight;

  return {
    mouthWidthRatio,
    eyeOpennessRatio,
    browLiftRatio,
    teethGapRatio,
  };
}

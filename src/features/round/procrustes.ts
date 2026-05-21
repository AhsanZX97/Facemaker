import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * MediaPipe canonical face-mesh indices for the regions that visually
 * define a troll face. Source: github.com/google/mediapipe/blob/master/
 * mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
 *
 * We deliberately exclude the jawline, forehead, brow, and nose. Those
 * are dominated by individual anatomy, not expression — including them
 * in the shape comparison would punish people for having a different-
 * shaped face, not a worse troll attempt.
 */
const LIPS_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17,
  84, 181, 91, 146,
];
const LIPS_INNER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14,
  87, 178, 88, 95,
];
const EYE_RIGHT = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];
const EYE_LEFT = [
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384,
  398,
];

/** The 72 landmarks we Procrustes-align between user and reference. */
export const SHAPE_INDICES = [
  ...LIPS_OUTER,
  ...LIPS_INNER,
  ...EYE_RIGHT,
  ...EYE_LEFT,
];

interface Pt {
  x: number;
  y: number;
}

/**
 * Procrustes alignment in 2D using the Kabsch algorithm.
 *
 * 1. Translate both point sets so each centroid is at the origin.
 * 2. Scale each so the root-mean-square distance from origin is 1.
 * 3. Find the rotation that minimises sum |R·q_i − p_i|² (closed-form
 *    via SVD on the 2×2 covariance matrix).
 * 4. Return RMSE between the aligned point sets — pure shape distance,
 *    invariant to translation, scale, and rotation.
 *
 * Inputs MUST have the same length and correspondence (i-th point in
 * `target` corresponds to i-th point in `source`).
 */
export function procrustesRmse(target: Pt[], source: Pt[]): number {
  if (target.length !== source.length || target.length === 0) return 1;

  const [tCentered, tScale] = centerAndScale(target);
  const [sCentered, sScale] = centerAndScale(source);
  if (tScale === 0 || sScale === 0) return 1;

  // Covariance matrix H = Sᵀ · T  (both 2D so H is 2×2).
  let h00 = 0;
  let h01 = 0;
  let h10 = 0;
  let h11 = 0;
  for (let i = 0; i < tCentered.length; i++) {
    h00 += sCentered[i].x * tCentered[i].x;
    h01 += sCentered[i].x * tCentered[i].y;
    h10 += sCentered[i].y * tCentered[i].x;
    h11 += sCentered[i].y * tCentered[i].y;
  }

  // SVD of a 2×2 matrix has a closed form. We need R = V · Uᵀ.
  const { u, vt } = svd2x2(h00, h01, h10, h11);
  // det check to avoid reflection — if det(R) < 0, flip the last column
  // of V so we get a proper rotation, not a reflection.
  let r00 = vt[0][0] * u[0][0] + vt[1][0] * u[0][1];
  let r01 = vt[0][0] * u[1][0] + vt[1][0] * u[1][1];
  let r10 = vt[0][1] * u[0][0] + vt[1][1] * u[0][1];
  let r11 = vt[0][1] * u[1][0] + vt[1][1] * u[1][1];
  const det = r00 * r11 - r01 * r10;
  if (det < 0) {
    // Flip the last column of V (equivalent to negating the last
    // singular value's contribution).
    r01 = -r01;
    r11 = -r11;
  }

  // Apply rotation to source and accumulate squared error.
  let sumSq = 0;
  for (let i = 0; i < tCentered.length; i++) {
    const sx = sCentered[i].x;
    const sy = sCentered[i].y;
    const rx = r00 * sx + r01 * sy;
    const ry = r10 * sx + r11 * sy;
    const dx = rx - tCentered[i].x;
    const dy = ry - tCentered[i].y;
    sumSq += dx * dx + dy * dy;
  }
  return Math.sqrt(sumSq / tCentered.length);
}

function centerAndScale(points: Pt[]): [Pt[], number] {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  const centered = points.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  let s = 0;
  for (const p of centered) s += p.x * p.x + p.y * p.y;
  s = Math.sqrt(s / centered.length);
  if (s === 0) return [centered, 0];
  for (const p of centered) {
    p.x /= s;
    p.y /= s;
  }
  return [centered, s];
}

/**
 * SVD of a 2×2 matrix. Returns u, singular values, vt such that
 * M = u · diag(s) · vt.
 *
 * Closed-form derivation: any 2×2 matrix decomposes via singular values
 * which are the square roots of eigenvalues of MᵀM. Standard linear
 * algebra — no iterative solver needed.
 */
function svd2x2(
  m00: number,
  m01: number,
  m10: number,
  m11: number,
): { u: number[][]; s: [number, number]; vt: number[][] } {
  // MᵀM = [[a, b], [b, c]] where a, b, c are:
  const a = m00 * m00 + m10 * m10;
  const b = m00 * m01 + m10 * m11;
  const c = m01 * m01 + m11 * m11;

  // Eigenvalues of MᵀM
  const trace = a + c;
  const det = a * c - b * b;
  const discriminant = Math.max(0, trace * trace - 4 * det);
  const sqrtDisc = Math.sqrt(discriminant);
  const e1 = (trace + sqrtDisc) / 2;
  const e2 = Math.max(0, (trace - sqrtDisc) / 2);

  const s1 = Math.sqrt(e1);
  const s2 = Math.sqrt(e2);

  // Right singular vectors (columns of V = rows of Vᵀ are eigenvectors of MᵀM)
  let v00 = 0;
  let v01 = 0;
  let v10 = 0;
  let v11 = 0;
  if (Math.abs(b) > 1e-10) {
    const theta = Math.atan2(2 * b, a - c) / 2;
    v00 = Math.cos(theta);
    v10 = Math.sin(theta);
    v01 = -v10;
    v11 = v00;
  } else if (a >= c) {
    v00 = 1; v10 = 0; v01 = 0; v11 = 1;
  } else {
    v00 = 0; v10 = 1; v01 = 1; v11 = 0;
  }
  const vt = [
    [v00, v10],
    [v01, v11],
  ];

  // U = M · V · Σ⁻¹
  const safe1 = s1 > 1e-10 ? 1 / s1 : 0;
  const safe2 = s2 > 1e-10 ? 1 / s2 : 0;
  const u00 = (m00 * v00 + m01 * v10) * safe1;
  const u10 = (m10 * v00 + m11 * v10) * safe1;
  const u01 = (m00 * v01 + m01 * v11) * safe2;
  const u11 = (m10 * v01 + m11 * v11) * safe2;
  const u = [
    [u00, u01],
    [u10, u11],
  ];

  return { u, s: [s1, s2], vt };
}

/**
 * Convert RMSE → 0–1 similarity score.
 *
 * Threshold is the RMSE at which the score hits 0. Tuned empirically:
 *   - Identical landmarks → RMSE 0 → score 1
 *   - Same person same expression → ~0.02 → score ~0.96
 *   - Recognisable troll attempt vs reference → 0.04–0.08 → ~0.85–0.7
 *   - Different expression (neutral vs troll) → 0.10–0.15 → ~0.5–0.25
 *   - Totally different (surprised, frowning) → 0.15+ → near 0
 *
 * The exponent makes the curve steeper near the high end — small RMSE
 * improvements at the top of the range are worth more than at the bottom.
 */
const RMSE_THRESHOLD = 0.18;

export function shapeScoreFromRmse(rmse: number): number {
  const linear = Math.max(0, 1 - rmse / RMSE_THRESHOLD);
  return Math.pow(linear, 1.4);
}

export function pickShapeSubset(
  landmarks: NormalizedLandmark[],
): Pt[] | null {
  if (!landmarks || landmarks.length < 478) return null;
  const out: Pt[] = [];
  for (const i of SHAPE_INDICES) {
    const p = landmarks[i];
    if (!p) return null;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

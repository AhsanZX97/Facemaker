import { describe, expect, it } from 'vitest';
import { procrustesRmse, shapeScoreFromRmse } from './procrustes';

describe('procrustesRmse', () => {
  it('returns ~0 for identical point sets', () => {
    const pts = [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.4 },
      { x: 0.7, y: 0.8 },
      { x: 0.3, y: 0.6 },
    ];
    expect(procrustesRmse(pts, pts)).toBeLessThan(1e-9);
  });

  it('returns ~0 when source is target translated', () => {
    const target = [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.4 },
      { x: 0.7, y: 0.8 },
      { x: 0.3, y: 0.6 },
    ];
    const source = target.map((p) => ({ x: p.x + 0.5, y: p.y - 0.3 }));
    expect(procrustesRmse(target, source)).toBeLessThan(1e-9);
  });

  it('returns ~0 when source is target scaled', () => {
    const target = [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.4 },
      { x: 0.7, y: 0.8 },
      { x: 0.3, y: 0.6 },
    ];
    const source = target.map((p) => ({ x: p.x * 3, y: p.y * 3 }));
    expect(procrustesRmse(target, source)).toBeLessThan(1e-9);
  });

  it('returns ~0 when source is target rotated 90°', () => {
    const target = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];
    // Rotate 90° clockwise: (x, y) → (y, -x)
    const source = target.map((p) => ({ x: p.y, y: -p.x }));
    expect(procrustesRmse(target, source)).toBeLessThan(1e-9);
  });

  it('returns a noticeable RMSE when shape genuinely differs', () => {
    // A square vs a "diamond" with one corner pulled out — different shape.
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const distorted = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1.5, y: 1.5 }, // pulled out
      { x: 0, y: 1 },
    ];
    expect(procrustesRmse(square, distorted)).toBeGreaterThan(0.05);
  });

  it('correctly handles reflection (avoids producing a reflection rotation)', () => {
    // A triangle vs its mirror image — should NOT align to zero, since
    // Procrustes here only allows rotations, not reflections.
    const tri = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ];
    const mirrored = tri.map((p) => ({ x: -p.x, y: p.y }));
    expect(procrustesRmse(tri, mirrored)).toBeGreaterThan(0.1);
  });

  it('returns 1 (max) for empty or mismatched inputs', () => {
    expect(procrustesRmse([], [])).toBe(1);
    expect(procrustesRmse([{ x: 0, y: 0 }], [])).toBe(1);
  });
});

describe('shapeScoreFromRmse', () => {
  it('maps 0 RMSE to score 1', () => {
    expect(shapeScoreFromRmse(0)).toBe(1);
  });

  it('maps the threshold (0.18) to score 0', () => {
    expect(shapeScoreFromRmse(0.18)).toBe(0);
  });

  it('maps anything above the threshold to 0', () => {
    expect(shapeScoreFromRmse(0.3)).toBe(0);
    expect(shapeScoreFromRmse(1)).toBe(0);
  });

  it('produces a decreasing score as RMSE grows', () => {
    const s1 = shapeScoreFromRmse(0.02);
    const s2 = shapeScoreFromRmse(0.06);
    const s3 = shapeScoreFromRmse(0.1);
    expect(s1).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s3);
  });
});

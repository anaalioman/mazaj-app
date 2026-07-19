import { pickBurstColors, shadesOf } from '../colors';
import type { BurstContext } from './types';

/**
 * The classic parametric heart curve:
 *   x(t) = 16 sin³(t)
 *   y(t) = 13 cos(t) - 5 cos(2t) - 2 cos(3t) - cos(4t)
 * for t in [0, 2π) — a real closed-form mathematical curve (not a traced
 * bitmap/SVG outline), scaled to arbitrary units. Screen y grows downward,
 * so the curve's own y is negated to keep the heart right-side up.
 */
function heartCurvePoint(t: number): { x: number; y: number } {
  const sinT = Math.sin(t);
  const x = 16 * sinT * sinT * sinT;
  const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
  return { x, y };
}

// Equal-arc-length reparameterization: the curve's own speed (|dx/dt, dy/dt|)
// is not constant, so sampling t at even steps bunches sparks up where the
// curve moves slowly and thins them out where it moves fast — a real,
// visible density variation around the heart's outline, not just at its
// tips. Built once at module load (the curve shape itself never changes
// burst to burst): sample the curve finely, accumulate real arc length,
// then invert that into a lookup table so `arcLengthParam(fraction)` returns
// the t value that lands exactly `fraction` of the way around the curve by
// actual distance traveled, not by raw parameter value.
const ARC_TABLE_SAMPLES = 2000;
const arcLengthToT: Float64Array = (function buildArcLengthTable(): Float64Array {
  const ts = new Float64Array(ARC_TABLE_SAMPLES + 1);
  const cumulative = new Float64Array(ARC_TABLE_SAMPLES + 1);
  let prev = heartCurvePoint(0);
  ts[0] = 0;
  cumulative[0] = 0;
  for (let i = 1; i <= ARC_TABLE_SAMPLES; i++) {
    const t = (i / ARC_TABLE_SAMPLES) * Math.PI * 2;
    const point = heartCurvePoint(t);
    cumulative[i] = cumulative[i - 1] + Math.hypot(point.x - prev.x, point.y - prev.y);
    ts[i] = t;
    prev = point;
  }

  const totalLength = cumulative[ARC_TABLE_SAMPLES];
  const inverse = new Float64Array(ARC_TABLE_SAMPLES + 1);
  let searchIndex = 0;
  for (let i = 0; i <= ARC_TABLE_SAMPLES; i++) {
    const targetLength = (i / ARC_TABLE_SAMPLES) * totalLength;
    while (searchIndex < ARC_TABLE_SAMPLES && cumulative[searchIndex + 1] < targetLength) searchIndex++;
    const segStart = cumulative[searchIndex];
    const segEnd = cumulative[Math.min(searchIndex + 1, ARC_TABLE_SAMPLES)];
    const segFrac = segEnd > segStart ? (targetLength - segStart) / (segEnd - segStart) : 0;
    const tStart = ts[searchIndex];
    const tEnd = ts[Math.min(searchIndex + 1, ARC_TABLE_SAMPLES)];
    inverse[i] = tStart + (tEnd - tStart) * segFrac;
  }
  return inverse;
})();

/** Returns the curve parameter t such that walking the heart curve from t=0 to this t covers exactly `fraction` (0-1) of its total real arc length. */
function arcLengthParam(fraction: number): number {
  const scaled = fraction * ARC_TABLE_SAMPLES;
  const index = Math.min(Math.floor(scaled), ARC_TABLE_SAMPLES - 1);
  const frac = scaled - index;
  return arcLengthToT[index] + (arcLengthToT[index + 1] - arcLengthToT[index]) * frac;
}

/**
 * Heart burst: every spark's initial velocity direction is the normalized
 * vector from the explosion center to `heartCurvePoint(t)`, sampled at
 * equal arc-length steps (see `arcLengthParam`) instead of equal parameter
 * steps — the same "velocity follows a parametric curve" technique
 * `burstRose` already uses for its k-petaled rose (see Rose.ts) and
 * `burstMultiRing` uses for its ellipses, just with the heart equation and
 * a proper arc-length reparameterization instead. The burst expands in
 * straight lines whose silhouette, a fraction of a second after ignition,
 * traces a heart shape with uniform density all the way around — computed
 * fresh every explosion in the ticker-driven spawn loop below, not a
 * static asset.
 *
 * Speed deliberately stays in a *narrow* band around `baseSpeed` (matching
 * Rose.ts's own convention), not Peony/Kamuro/Strobe's `ctx.fillSpeed()`,
 * which samples the *full* 0..max range to fill a sphere's interior with
 * depth. That's correct for a circularly-symmetric bloom, but wrong for a
 * shape whose entire identity is its outline: filling the heart's interior
 * with particles at random, short radii just paints a formless core blob
 * that swamps the curve's silhouette. A thin shell keeps every spark close
 * to the actual curve, so the heart reads as a heart.
 */
export function burstHeart(x: number, y: number, ctx: BurstContext): void {
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : pickBurstColors(3 + Math.floor(Math.random() * 2));
  const count = Math.max(24, Math.round(170 * ctx.densityRatio));
  const baseSpeed = (2.9 + Math.random() * 1.0) * ctx.settings.explosionScale;

  for (let i = 0; i < count; i++) {
    const t = arcLengthParam(i / count);
    const point = heartCurvePoint(t);
    const magnitude = Math.hypot(point.x, point.y) || 1;
    const dirX = point.x / magnitude;
    const dirY = point.y / magnitude;
    const speed = baseSpeed * (0.92 + Math.random() * 0.16);
    const color = burstColors[Math.floor(Math.random() * burstColors.length)];

    ctx.spawn({
      x,
      y,
      vx: dirX * speed,
      vy: dirY * speed,
      color,
      size: (7 + Math.random() * 4) * ctx.glowSizeBoost,
      life: (62 + Math.random() * 28) * ctx.settings.lifespanScale,
      gravity: 0.07 * ctx.settings.gravityScale,
      drag: 0.985,
      twinkle: Math.random() < 0.3,
    });
  }
}

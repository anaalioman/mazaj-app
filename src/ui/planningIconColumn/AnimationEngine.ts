import { Sprite, type Container, type Ticker } from 'pixi.js';
import { atlasTexture } from '../svgIconTexture';
import { tickerSetTimeout } from '../../utils/tickerTimers';
import { fastSin, TWO_PI } from '../../fireworks/SineTable';
import {
  BOUNCE_DURATION_MS,
  BOUNCE_MIN_SCALE,
  FLASH_COLOR,
  FLASH_MS,
  GLOW_ACTIVE_BOOST,
  GLOW_BREATHE_MAX,
  GLOW_BREATHE_MIN,
  GLOW_BREATHE_SPEED,
  GLOW_TAP_BOOST,
  type Row,
} from './types';

/**
 * `ticker.lastTime` the current tap's bounce+glow-boost spike started at, or
 * -1 once it's settled, plus which row it belongs to — passed by reference
 * into `syncRowGlow()`/`triggerBounce()` so the state persists across ticker
 * frames without needing a class of its own. Owned by ColumnContainer,
 * mutated only through this module's functions.
 */
export interface BounceState {
  start: number;
  row: Row | null;
  /**
   * Radians in `[0, TWO_PI)` for the shared breathing-glow wave —
   * incrementally advanced and wrapped once per frame in `syncRowGlow()`
   * (same convention as `background.ts`'s own per-star `wavePos`), never
   * re-derived from `ticker.lastTime` (which only ever grows) via a live
   * `Math.sin()`.
   */
  breathePhase: number;
}

export function createBounceState(): BounceState {
  return { start: -1, row: null, breathePhase: 0 };
}

/** Standard "ease out bounce" (easings.net) — a ball dropped and settling, three diminishing bounces, never overshooting past 1. `t` and the return value are both 0..1. Mirrors TextComposer.ts's own copy (kept file-local rather than shared, same reasoning as this file's other small pure-math helpers). */
export function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** Marks `row` as the one bouncing, starting now — read back by `syncRowGlow()` on every subsequent frame until it settles. */
export function triggerBounce(state: BounceState, ticker: Ticker, row: Row): void {
  state.start = ticker.lastTime;
  state.row = row;
}

/**
 * Per-frame sync for every row's breathing glow — the only thing here that
 * genuinely needs to run every tick, since `GlowFilter.outerStrength` is a
 * live, continuously-varying shader parameter, not something a static baked
 * pixel could reproduce. The plate's own idle/active look is two pre-baked
 * sprites now (see RowComponent's plateIdle/plateActive) whose alpha
 * ColumnContainer's setActive() toggles once on actual state change — this
 * function never touches them, so there's no per-frame Graphics redraw left
 * in this loop at all.
 */
export function syncRowGlow(rows: Map<string, Row>, state: BounceState, ticker: Ticker): void {
  let spike = 0;
  if (state.start >= 0) {
    const t = Math.min(1, (ticker.lastTime - state.start) / BOUNCE_DURATION_MS);
    const eased = easeOutBounce(t);
    state.row?.root.scale.set(BOUNCE_MIN_SCALE + eased * (1 - BOUNCE_MIN_SCALE));
    spike = (1 - eased) * GLOW_TAP_BOOST;
    if (t >= 1) {
      state.row?.root.scale.set(1);
      state.start = -1;
      state.row = null;
      spike = 0;
    }
  }

  state.breathePhase += ticker.deltaMS * GLOW_BREATHE_SPEED;
  if (state.breathePhase >= TWO_PI) state.breathePhase -= TWO_PI;
  const breathe = GLOW_BREATHE_MIN + ((fastSin(state.breathePhase) + 1) / 2) * (GLOW_BREATHE_MAX - GLOW_BREATHE_MIN);
  for (const row of rows.values()) {
    const isBouncing = row === state.row;
    row.glow.outerStrength = breathe + (row.active ? GLOW_ACTIVE_BOOST : 0) + (isBouncing ? spike : 0);
  }
}

/** Tactile tap feedback (the old `.mzj-flash` cyan glow) — a pre-baked radial-falloff sprite (`planningFlashHalo`, see scripts/generateIconAtlas.mjs) tinted at runtime, instead of tessellating fresh Graphics geometry on every tap. */
export function flashTap(target: Container, ticker: Ticker): void {
  const halo = new Sprite(atlasTexture('planningFlashHalo'));
  halo.anchor.set(0.5);
  halo.tint = FLASH_COLOR;
  halo.blendMode = 'add';
  const diameter = 52; // matches the old halo's outer radius (26) * 2
  halo.width = diameter;
  halo.height = diameter;
  target.addChildAt(halo, 0);
  tickerSetTimeout(
    ticker,
    () => {
      halo.destroy();
    },
    FLASH_MS,
  );
}

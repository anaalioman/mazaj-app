import { FillGradient, Graphics, type Container, type Ticker } from 'pixi.js';
import { tickerSetTimeout } from '../../utils/tickerTimers';
import {
  BG_METALLIC_BOTTOM,
  BG_METALLIC_BOTTOM_ACTIVE,
  BG_METALLIC_TOP,
  BG_METALLIC_TOP_ACTIVE,
  BG_RADIUS,
  BOUNCE_DURATION_MS,
  BOUNCE_MIN_SCALE,
  FLASH_COLOR,
  FLASH_MS,
  GLOW_ACTIVE_BOOST,
  GLOW_BREATHE_MAX,
  GLOW_BREATHE_MIN,
  GLOW_BREATHE_SPEED,
  GLOW_TAP_BOOST,
  ICON_GOLD,
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
}

export function createBounceState(): BounceState {
  return { start: -1, row: null };
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
 * Per-frame visual sync for every row's golden-metallic plate — cheap even
 * mid-bounce: the eased spike only computes for `state.row`, every other
 * row just re-reads its own static idle/active breathing level. Runs for
 * all rows every frame (not just the bouncing one) since the idle breathe
 * itself is continuous, not triggered.
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

  const breathe = GLOW_BREATHE_MIN + ((Math.sin(ticker.lastTime * GLOW_BREATHE_SPEED) + 1) / 2) * (GLOW_BREATHE_MAX - GLOW_BREATHE_MIN);
  for (const row of rows.values()) {
    const isBouncing = row === state.row;
    row.glow.outerStrength = breathe + (row.active ? GLOW_ACTIVE_BOOST : 0) + (isBouncing ? spike : 0);

    const fill = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: row.active
        ? [{ offset: 0, color: BG_METALLIC_TOP_ACTIVE }, { offset: 1, color: BG_METALLIC_BOTTOM_ACTIVE }]
        : [{ offset: 0, color: BG_METALLIC_TOP }, { offset: 1, color: BG_METALLIC_BOTTOM }],
    });
    row.bg
      .clear()
      .circle(0, 0, BG_RADIUS)
      .fill(fill)
      .stroke({ width: 1.2, color: ICON_GOLD, alpha: row.active ? 0.55 : 0.22 });
  }
}

/** Tactile tap feedback (the old `.mzj-flash` cyan glow) — a temporary additive halo, not a CSS box-shadow. */
export function flashTap(target: Container, ticker: Ticker): void {
  const halo = new Graphics();
  const steps = 5;
  const radius = 26;
  for (let i = steps; i > 0; i--) {
    const t = i / steps;
    halo.circle(0, 0, radius * t).fill({ color: FLASH_COLOR, alpha: (1 - t) * 0.55 });
  }
  halo.blendMode = 'add';
  target.addChildAt(halo, 0);
  tickerSetTimeout(
    ticker,
    () => {
      halo.destroy();
    },
    FLASH_MS,
  );
}

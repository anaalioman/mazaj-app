import type { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { GlowFilter } from 'pixi-filters';
import type { IconName } from '../icons';

/**
 * Geometry ported 1:1 from the old `.mzj-planning-side-right` CSS (a
 * `flex-direction: column; align-items: center` list inside
 * `#mzj-planning-screen`'s `padding: 76px 16px 24px`) — measured directly
 * off a live render (getBoundingClientRect on every row) rather than
 * guessed. Every row shared the exact same horizontal center regardless of
 * its own label's width (flex centers each child independently on the
 * column's centerline), so `COLUMN_RIGHT_INSET` is that one fixed inset,
 * not a per-row calculation.
 */
export const PADDING_TOP = 76;
// Bumped from 24: a real, reproduced bug on short screens had the column's
// tail rows (glow, "لون المقذوفة") render past app.screen.height entirely —
// see LayoutManager's own doc comment for the actual fix. This margin is
// the bottom safe-area clearance off the screen edge (system nav bars etc.).
export const PADDING_BOTTOM = 60;
export const COLUMN_RIGHT_INSET = 56;
export const ROW_HEIGHT = 38;
export const ROW_GAP = 20;
export const ROW_SPACING = ROW_HEIGHT + ROW_GAP;
export const ICON_SIZE = 22;
export const ICON_SOURCE_SIZE = 44;
/**
 * Minimum touch target on both axes (Android's own accessibility guideline
 * is 48dp; 44 matches what the rest of this codebase already standardized
 * on). Each row's real hitArea is computed from the icon+label's *actual*
 * rendered bounds (see RowComponent's `computeHitArea()`) — not a flat
 * guess — then padded out to at least this size so short labels ("قلب")
 * still get a comfortable target. Longer labels ("توليد عشوائي هجين") can
 * and do exceed this on their own; the computed hitArea grows with them
 * instead of clipping them.
 */
export const HIT_MIN_SIZE = 44;
/** Extra breathing room on every side beyond the tight content bounds, so a finger landing just past a glyph's edge still registers. */
export const HIT_PADDING = 8;

export const IDLE_ALPHA = 0.75;
/** The icon glyphs' unified gold identity — the row labels stay the old CSS's plain white, only the icons themselves carry this. */
export const ICON_GOLD = 0xfff6df;
export const LABEL_TINT = 0xffffff;
export const FLASH_COLOR = 0x06b6d4;
export const FLASH_MS = 180;
export const RECORD_COLOR = 0xff5a63;
export const RECORD_PULSE_MS = 1000;

/**
 * The soft rounded "premium button" plate behind every icon — same golden-
 * metallic family already established for TextComposer's compose-mode row
 * (dark-navy-to-black idle, warming to gold when active), so this column
 * reads as the same visual language rather than a separately-invented look.
 */
/** Diameter (40) stays just inside HIT_MIN_SIZE (44) so the visible plate never pokes out past its own row's tappable hitArea. */
export const BG_RADIUS = 20;
export const BG_METALLIC_TOP = 0x201c14;
export const BG_METALLIC_BOTTOM = 0x0a0906;
export const BG_METALLIC_TOP_ACTIVE = 0x5a4620;
export const BG_METALLIC_BOTTOM_ACTIVE = 0x1c1508;
/**
 * "تتنفس بنعومة" — a slow, continuous idle glow every row always carries
 * (never fully off), oscillating between these two bounds via a plain sine
 * wave driven by `ticker.lastTime` — the same technique syncPreviewGlow()
 * (TextComposer.ts) already uses for the committed text's own breathing
 * halo. `GLOW_ACTIVE_BOOST` is the sustained brighter floor for whichever
 * row is currently "active" (see ColumnContainer's setActive());
 * `GLOW_TAP_BOOST` is a further transient spike on top of that, decaying
 * back down over BOUNCE_DURATION_MS via the same eased-decay technique
 * TextComposer's mode row already uses (easeOutBounce/BounceState, see
 * AnimationEngine.ts).
 */
export const GLOW_BREATHE_MIN = 0.4;
export const GLOW_BREATHE_MAX = 0.9;
export const GLOW_BREATHE_SPEED = 0.0018;
export const GLOW_ACTIVE_BOOST = 1.1;
export const GLOW_TAP_BOOST = 2.4;
export const BOUNCE_MIN_SCALE = 0.86;
export const BOUNCE_DURATION_MS = 260;
/** Freshly-resolved icon textures fade in over this long instead of popping in abruptly — see RowComponent's own iconTexture().then(). */
export const ICON_FADE_IN_MS = 150;

export interface IconRowSpec {
  id: string;
  /** 'T' draws the literal glyph (the old `.mzj-planning-text-icon` span) instead of a rasterized icon — the text-composer trigger has no line-icon artwork of its own. */
  icon: IconName | 'T';
  label: string;
  onTap: () => void;
  /** Opts out of the generic UI-click tick — for rows whose own onTap already plays a more specific sound (e.g. "لقطة"'s camera shutter) that a second, generic blip on top of would just muddy. */
  skipDefaultClickSound?: boolean;
}

export interface Row {
  id: string;
  root: Container;
  /** The golden-metallic plate behind icon+label — see BG_* constants' own doc comment. Redrawn every frame (breathing glow + active/tap state), see AnimationEngine.ts's syncRowGlow(). */
  bg: Graphics;
  /** Dedicated per-row GlowFilter driving the continuous idle breathing pulse plus the active/tap boosts — not shared, so each row's own animation phase/state stays independent. */
  glow: GlowFilter;
  icon: Sprite | Text;
  label: Text;
  active: boolean;
  recordGlow?: Graphics;
}

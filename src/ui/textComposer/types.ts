import type { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import type { GlowFilter } from 'pixi-filters';
import type { IconName } from '../icons';
import type { AudioManager } from '../../audio/AudioManager';

export interface TextRevealConfig {
  text: string;
  x: number;
  y: number;
  fontScale: number;
  /** Radians, same convention as Pixi's own `rotation` (0 = upright, clockwise-positive). */
  rotation: number;
  /** Whether "سحابة دخان" was the player's choice for this text — see consumeForReveal()'s own doc comment for why this only ever plays once passed through to TextReveal's own `smokeCloud` option, never in the composer itself. */
  smokeCloud: boolean;
}

export interface TextComposerDeps {
  app: Application;
  audio: AudioManager;
  /** The committed text (`previewText`) is genuine scene content — it belongs in `worldContainer` so it's captured by snapshot/recording exactly like the rest of the show. See fireworksMood.ts's own container-tree doc comment. */
  worldContainer: Container;
  /** Everything else this class draws (the effects-bar chrome, the control box's border/handles, the tap-outside backdrop) is editing-time UI, not final art — it belongs in `uiContainer`. */
  uiContainer: Container;
  /** True while the input+effects bar OR the control box is open — lets the caller hide whatever else is on screen (e.g. the planning screen's own icon columns) so this stays the sole focus. */
  onComposingChange: (composing: boolean) => void;
}

/** One compose-mode-row item — see ComposeMode's/RowMode's own doc comments. `glow` is a dedicated GlowFilter instance per icon (not shared) so each can carry its own independent idle/active/tap-boost level every frame — see ModeRowEngine's syncComposeModeFrames(). `stackable` mirrors its own ComposeModeEntry (copied here rather than re-looked-up every frame). */
export interface ComposeModeFrameObj {
  mode: RowMode;
  stackable: boolean;
  root: Container;
  border: Graphics;
  glyph: Sprite;
  glow: GlowFilter;
  label: Text;
}

/**
 * The composer's own text field, root-centered like every other control in
 * this file: a background pill, a dimmed placeholder shown when empty, and
 * — inside `scrollGroup`, clipped by `mask` — the live typed text and its
 * blinking gold caret. `scrollGroup` is right-edge anchored (RTL: the first
 * typed character sits at the pill's right inner edge, later characters
 * extend left) and pans horizontally once the line outgrows the pill's own
 * width — see InputFieldView's refreshInputVisual() for why panning, not
 * shrinking or wrapping.
 */
export interface InputFieldObj {
  root: Container;
  bg: Graphics;
  scrollGroup: Container;
  mask: Graphics;
  text: Text;
  placeholder: Text;
  cursor: Graphics;
}

/** No default text — an empty composer/commit stays empty (see confirmAndOpenControlBox() and TextReveal.reveal()'s own empty-string guard), rather than falling back to a canned greeting. */
export const SAMPLE_PHRASE = '';

/**
 * Geometry ported 1:1 from the old `#mzj-text-composer`/`.mzj-text-composer-*`
 * CSS (measured directly off a live render, same methodology as every other
 * converted window) — a fixed-width panel pinned to the top-center of the
 * screen, an RTL topbar (back circle at the right, input filling the rest),
 * then a flex-wrap grid of effect frames that centers each row exactly the
 * way `flex-wrap: wrap; justify-content: center` used to.
 */
export const COMPOSER_TOP_Y = 68;
export const COMPOSER_MAX_WIDTH = 460;
export const COMPOSER_WIDTH_RATIO = 0.94;
export const BACK_DIAMETER = 34;
export const GAP_BACK_INPUT = 8;
export const TOPBAR_HEIGHT = 36;
export const INPUT_HEIGHT = 36;
export const EFFECTS_MARGIN_TOP = 10;
export const PREVIEW_W = 78;
export const PREVIEW_H = 44;
export const PREVIEW_RADIUS = 10;
export const ITEM_GAP_X = 14;
export const LABEL_GAP = 5;
export const LABEL_FONT_SIZE = 10;
export const LABEL_LINE_HEIGHT = 12;
export const ITEM_HEIGHT = PREVIEW_H + LABEL_GAP + LABEL_LINE_HEIGHT;
/** Real Pixi hitArea per finger — same reasoning as every other control converted this session. Each item's own footprint (78x61) already clears the 44x44 floor. */
export const FRAME_HIT_WIDTH = PREVIEW_W;
export const FRAME_HIT_HEIGHT = ITEM_HEIGHT;
/** Root is centered on the *border box*, not the whole item — so the hitArea's vertical span is deliberately asymmetric (see ModeRowEngine's buildComposeModeFrame()): it starts exactly at the box's own top edge (no wasted margin that would creep into the row above) and extends down through the label. */
export const FRAME_HIT_TOP = -PREVIEW_H / 2;

/** The mode row's unified gold identity — same color/filter recipe as the header and the planning screen's icon column, applied to every frame's border so the whole app reads as one visual language. */
export const EFFECT_GOLD = 0xfff6df;
export const FRAME_BORDER_IDLE_ALPHA = 0.22;
export const FRAME_BORDER_ACTIVE_ALPHA = 0.9;
export const LABEL_IDLE_COLOR = 0xffffff;
export const LABEL_IDLE_ALPHA = 0.65;
export const LABEL_ACTIVE_COLOR = 0xffffff;

/**
 * The committed text's "breathing" glow: outerStrength oscillates between
 * these two bounds via a plain sine wave driven by `ticker.lastTime`
 * (radians/ms — one full breath roughly every 2.6s) rather than any
 * timer — see PreviewControlBox's syncPreviewGlow(). `GlowFilter`, not
 * `BlurFilter`: a blur would soften the glyphs themselves, while GlowFilter
 * (knockout: false) always draws the original source untouched and only
 * adds a halo outward from its edges — that's what keeps the letters
 * reading crisp underneath the glow, not any MSDF/distance-field font
 * technique (this app has never used one; every `Text` here is Pixi's
 * ordinary Canvas-rasterized text).
 */
export const GLOW_PULSE_MIN = 1.4;
export const GLOW_PULSE_MAX = 3.4;
export const GLOW_PULSE_SPEED = 0.0024;
export const GLOW_DISTANCE = 10;
export const GLOW_QUALITY = 0.3;

/**
 * The live input field's own "pop" — the whole typed line (not per
 * character: splitting the *source string* into independent glyphs, e.g.
 * PixiJS v8.11+'s own `SplitText`, was tried and confirmed live to shape
 * every Arabic letter in isolation, breaking every join — see
 * InputFieldView's refreshInputVisual() own doc comment) scales from
 * INPUT_BOUNCE_MIN_SCALE up to 1 via easeOutBounce() every time a
 * keystroke actually *adds* characters (not on deletion — see
 * ModeRowEngine's triggerInputBounce()). `text.origin` (Container's real v8
 * property, distinct from `pivot`: changing it re-centers the scale pivot
 * without moving the object's own position) is recomputed to the text's own
 * current visual center on every trigger, so the pop reads as growing
 * outward from the middle of whatever's currently typed rather than from
 * the fixed right-edge anchor corner. `inputGlow`'s outerStrength is
 * driven by the exact same per-frame `eased` value as the scale (see
 * syncInputBounce()), so the two are mathematically locked together, not
 * merely started at the same time — glow brightens exactly as the pop
 * grows and settles back to its own resting level the instant the bounce
 * finishes.
 */
export const INPUT_BOUNCE_MIN_SCALE = 0.8;
export const INPUT_BOUNCE_DURATION_MS = 220;
export const INPUT_GLOW_BASE = 0.6;
export const INPUT_GLOW_BOOST = 2.6;

/**
 * "الخروج الدرامي" — a deleted character bursts into a handful of embers
 * instead of just vanishing. Reuses `Particle` (src/fireworks/Particle.ts)
 * as-is rather than a parallel particle system: it already renders through
 * two `ParticleContainer`s (trail + core, additive-blended, the exact
 * mechanism FireworksSystem.ts's own bursts use), already fades via alpha
 * and falls via gravity every frame, and already pools cleanly (`kill()`
 * hides instead of destroying — see that class's own doc comment) — the
 * same object, the same texture, the same battle-tested per-frame cost as
 * every rocket burst already on screen elsewhere in this app.
 */
export const DELETE_SPARK_COUNT_MIN = 10;
export const DELETE_SPARK_COUNT_MAX = 15;
export const DELETE_SPARK_LIFE_MIN = 26;
export const DELETE_SPARK_LIFE_MAX = 46; // frames — well under 60 (~1s at 60fps), per the "less than a second" requirement
/** Sized to actually read as a burst against the input pill's own busy background (small glyphs, gold glow) — not the microscopic 2-3px a literal "one burnt character" scale would give, which live-testing showed was nearly invisible. */
export const DELETE_SPARK_SIZE_MIN = 5;
export const DELETE_SPARK_SIZE_MAX = 8;

/** Plain glass chrome, matching HeaderBar's own back/home buttons — not part of the gold identity, which belongs to content (the effect frames), not navigation. */
export const BACK_BG_COLOR = 0xffffff;
export const BACK_BG_ALPHA = 0.06;
export const BACK_ICON_TINT = 0xe5e7eb;
export const BACK_ICON_SIZE = 18;
export const BACK_ICON_SOURCE_SIZE = 40;
/** Real Pixi hitArea per finger — the visible circle stays BACK_DIAMETER (34px), the tappable area is still a generous 44x44 floor. */
export const BACK_HIT_SIZE = 44;

/**
 * The input field's genuine Pixi visuals — text, placeholder, and a
 * blinking gold caret, all real `Text`/`Graphics` on `app.stage`. See
 * GhostInputBridge for the hidden native `<textarea>` that feeds `this.text`
 * (and therefore this display) its characters via the OS's own keyboard.
 */
export const INPUT_FONT_SIZE = 15;
/** Explicit, not left to Pixi's own fontSize-based default — multi-line spacing has to be predictable since refreshInputVisual() computes the vertical auto-scroll/caret position from it directly. */
export const INPUT_LINE_HEIGHT = Math.round(INPUT_FONT_SIZE * 1.3);
export const INPUT_TEXT_COLOR = 0xffe9b3;
/** Same gold/fire identity as the text itself — "وكأن الحرف نفسه قد احترق". */
export const DELETE_SPARK_COLORS = [EFFECT_GOLD, 0xffb04c, INPUT_TEXT_COLOR];

/**
 * Composing-time behavior modes — an exclusive-select icon row below the
 * input, with its own "off" state: `'none'` (the default — matches every
 * mode being unconditionally off until the player deliberately opts in) and
 * tapping the currently-active icon again returns to `'none'`. Tapping one
 * of these keeps composing (unlike the back arrow, which commits) — these
 * three stay live *while* still typing, so a commit-on-tap would defeat the
 * whole point.
 * - `'spring'` gates the input field's own insert-pop (see
 *   INPUT_BOUNCE_* constants) — previously unconditional on every keystroke
 *   that grew the string; now only while this mode is active.
 * - `'spark-eraser'` gates the delete-ember burst (see DELETE_SPARK_*
 *   constants) — previously unconditional on every deletion; same story.
 * - `'fuse'` is genuinely new: a lit rope drawn under the input text (see
 *   FUSE_* constants and syncFuseEffect()) with a traveling ember.
 */
export type ComposeMode = 'none' | 'fuse' | 'spark-eraser' | 'spring';

/**
 * `'smoke-cloud'` is the row's odd one out — every other entry is a value
 * of the single exclusive `ComposeMode` enum above, but this one is a
 * genuinely independent on/off toggle (see `smokeCloudActive`) that stacks
 * freely alongside whichever `ComposeMode` (if any) is also active, per its
 * own explicit "stackable" requirement. `RowMode` exists purely so
 * `ComposeModeFrameObj.mode` can still identify *which* icon a frame is
 * without forcing this one into the exclusive enum it doesn't belong to.
 */
export type RowMode = ComposeMode | 'smoke-cloud';

/** One entry per new-row icon: its mode id, its 24x24 line-icon name (see ui/icons.ts), its Arabic label, and whether it's this row's one stackable/independent toggle rather than a member of the exclusive ComposeMode selection. */
export interface ComposeModeEntry {
  mode: RowMode;
  icon: IconName;
  label: string;
  stackable: boolean;
}
export const COMPOSE_MODE_ENTRIES: ComposeModeEntry[] = [
  { mode: 'fuse', icon: 'fuse', label: 'فتيل مشتعل', stackable: false },
  { mode: 'spark-eraser', icon: 'sparkEraser', label: 'ممحاة نارية', stackable: false },
  { mode: 'spring', icon: 'spring', label: 'نابض مرن', stackable: false },
  { mode: 'smoke-cloud', icon: 'cloud', label: 'سحابة دخان', stackable: true },
];

/**
 * "Golden metallic" identity for the mode row — a warm gradient that reads
 * as its own family of controls. `MODE_GLOW_BASE` is the
 * *idle* dim halo every icon in this row always carries (per "توهج ناعم" —
 * a soft ambient glow, not fully dark); `MODE_GLOW_ACTIVE` is the sustained
 * brighter level for whichever mode is currently selected;
 * `MODE_GLOW_TAP_BOOST` is a further, transient spike layered on top of
 * whichever of those two the icon is already at, decaying back down over
 * `MODE_BOUNCE_DURATION_MS` — the same eased-decay technique
 * syncInputBounce() already uses for the input field's own pop, reused here
 * via modeBounceStart/easeOutBounce.
 */
export const MODE_ICON_SIZE_SOURCE = 28;
export const MODE_ICON_SIZE = 22;
export const MODE_METALLIC_TOP = 0x4a3a18;
export const MODE_METALLIC_BOTTOM = 0x1a1408;
export const MODE_METALLIC_TOP_ACTIVE = 0x8a6a28;
export const MODE_METALLIC_BOTTOM_ACTIVE = 0x2c2008;
export const MODE_GLOW_BASE = 0.5;
export const MODE_GLOW_ACTIVE = 1.4;
export const MODE_GLOW_TAP_BOOST = 2.2;
export const MODE_BOUNCE_MIN_SCALE = 0.85;
export const MODE_BOUNCE_DURATION_MS = 260;
export const MODE_ROW_MARGIN_TOP = 14;

/**
 * "الفتيل المشتعل تحت النص" — a glowing rope (real `Graphics`, redrawn
 * every frame it's visible so it always matches the input text's own
 * current width exactly, never a stale cached shape) spanning the input
 * text, with a bright ember sliding back and forth along it
 * (Math.sin-driven off `ticker.lastTime`, the same pulse technique
 * syncPreviewGlow() already uses) and — every FUSE_EMBER_SPAWN_INTERVAL_MS
 * or so — a single small spark peeling off the ember, reusing this class's
 * *own* delete-spark Particle pool rather than a third parallel particle
 * system.
 */
/** Bright enough to read against the composer's own near-black background — a literal rope-brown was tried first and live-tested nearly invisible there. */
export const FUSE_ROPE_COLOR = 0xb08040;
export const FUSE_ROPE_WIDTH = 3;
/** Stays inside EFFECTS_MARGIN_TOP's own 10px gap — see ModeRowEngine's syncFuseEffect()'s own doc comment on why ropeY anchors to TOPBAR_HEIGHT rather than the caret line. */
export const FUSE_ROPE_GAP_BELOW_TEXT = 5;
export const FUSE_EMBER_COLOR = 0xfff2c2;
export const FUSE_EMBER_RADIUS = 3.5;
export const FUSE_EMBER_GLOW = 2.4;
export const FUSE_EMBER_SPEED = 0.0016;
export const FUSE_EMBER_SPAWN_INTERVAL_MS = 140;

export const PLACEHOLDER_TEXT = 'اكتب عبارتك هنا';
export const PLACEHOLDER_COLOR = 0xffffff;
export const PLACEHOLDER_ALPHA = 0.4;
export const CURSOR_WIDTH = 2;
export const CURSOR_HEIGHT = 20;
export const CURSOR_GAP = 3;
/** Standard OS caret blink interval (matches Chrome/Android's own ~530ms default). */
export const CURSOR_BLINK_MS = 530;
/** The Pixi hitArea is deliberately taller than the visible 36px pill — same 44px-floor rule as every other tappable control this session. */
export const INPUT_HIT_HEIGHT = 44;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Standard "ease out bounce" (easings.net) — a ball dropped and settling, three diminishing bounces, never overshooting past 1. `t` and the return value are both 0..1. */
export function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/**
 * The `[start, end)` range in `longer` that isn't in `shorter` — a plain
 * common-prefix/common-suffix diff. Used both directions: called as
 * `diffChangedRange(oldText, newText)` it finds what a keystroke just
 * *inserted*; called as `diffChangedRange(newText, oldText)` (arguments
 * swapped) it finds what a deletion just *removed*, since the same
 * "shorter vs longer" logic applies symmetrically either way. Returns an
 * empty range if `longer` isn't actually longer than `shorter`.
 */
export function diffChangedRange(shorter: string, longer: string): { start: number; end: number } {
  if (longer.length <= shorter.length) return { start: 0, end: 0 };
  const maxPrefix = Math.min(shorter.length, longer.length);
  let prefix = 0;
  while (prefix < maxPrefix && shorter[prefix] === longer[prefix]) prefix++;
  const maxSuffix = Math.min(shorter.length, longer.length) - prefix;
  let suffix = 0;
  while (suffix < maxSuffix && shorter[shorter.length - 1 - suffix] === longer[longer.length - 1 - suffix]) suffix++;
  return { start: prefix, end: longer.length - suffix };
}

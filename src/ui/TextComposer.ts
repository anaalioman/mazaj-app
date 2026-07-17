import { Application, CanvasTextMetrics, Container, FillGradient, Graphics, ParticleContainer, Rectangle, Sprite, Text, TextStyle, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { AdvancedBloomFilter, DropShadowFilter, GlowFilter } from 'pixi-filters';
import { iconTexture } from './svgIconTexture';
import type { IconName } from './icons';
import type { AudioManager } from '../audio/AudioManager';
import { tickerSetInterval, type TickerTimerHandle } from '../utils/tickerTimers';
import { createHiddenTextArea } from '../dom/shadowServices';
import { Transformer, type TransformerTarget } from './Transformer';
import { Particle } from '../fireworks/Particle';
import { getParticleTexture } from '../fireworks/textures';

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

/** One compose-mode-row item — see ComposeMode's/RowMode's own doc comments. `glow` is a dedicated GlowFilter instance per icon (not shared) so each can carry its own independent idle/active/tap-boost level every frame — see syncComposeModeFrames(). `stackable` mirrors its own ComposeModeEntry (copied here rather than re-looked-up every frame). */
interface ComposeModeFrameObj {
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
 * width — see refreshInputVisual()'s own doc comment for why panning,
 * not shrinking or wrapping.
 */
interface InputFieldObj {
  root: Container;
  bg: Graphics;
  scrollGroup: Container;
  mask: Graphics;
  text: Text;
  placeholder: Text;
  cursor: Graphics;
}

const SAMPLE_PHRASE = 'مبروك';

/**
 * Geometry ported 1:1 from the old `#mzj-text-composer`/`.mzj-text-composer-*`
 * CSS (measured directly off a live render, same methodology as every other
 * converted window) — a fixed-width panel pinned to the top-center of the
 * screen, an RTL topbar (back circle at the right, input filling the rest),
 * then a flex-wrap grid of effect frames that centers each row exactly the
 * way `flex-wrap: wrap; justify-content: center` used to.
 */
const COMPOSER_TOP_Y = 68;
const COMPOSER_MAX_WIDTH = 460;
const COMPOSER_WIDTH_RATIO = 0.94;
const BACK_DIAMETER = 34;
const GAP_BACK_INPUT = 8;
const TOPBAR_HEIGHT = 36;
const INPUT_HEIGHT = 36;
const EFFECTS_MARGIN_TOP = 10;
const PREVIEW_W = 78;
const PREVIEW_H = 44;
const PREVIEW_RADIUS = 10;
const ITEM_GAP_X = 14;
const LABEL_GAP = 5;
const LABEL_FONT_SIZE = 10;
const LABEL_LINE_HEIGHT = 12;
const ITEM_HEIGHT = PREVIEW_H + LABEL_GAP + LABEL_LINE_HEIGHT;
/** Real Pixi hitArea per finger — same reasoning as every other control converted this session. Each item's own footprint (78x61) already clears the 44x44 floor. */
const FRAME_HIT_WIDTH = PREVIEW_W;
const FRAME_HIT_HEIGHT = ITEM_HEIGHT;
/** Root is centered on the *border box*, not the whole item — so the hitArea's vertical span is deliberately asymmetric (see buildComposeModeFrame()): it starts exactly at the box's own top edge (no wasted margin that would creep into the row above) and extends down through the label. */
const FRAME_HIT_TOP = -PREVIEW_H / 2;

/** The mode row's unified gold identity — same color/filter recipe as the header and the planning screen's icon column, applied to every frame's border so the whole app reads as one visual language. */
const EFFECT_GOLD = 0xfff6df;
const FRAME_BORDER_IDLE_ALPHA = 0.22;
const FRAME_BORDER_ACTIVE_ALPHA = 0.9;
const LABEL_IDLE_COLOR = 0xffffff;
const LABEL_IDLE_ALPHA = 0.65;
const LABEL_ACTIVE_COLOR = 0xffffff;

/**
 * The committed text's "breathing" glow: outerStrength oscillates between
 * these two bounds via a plain sine wave driven by `ticker.lastTime`
 * (radians/ms — one full breath roughly every 2.6s) rather than any
 * timer — see syncPreviewGlow(). `GlowFilter`, not `BlurFilter`: a blur
 * would soften the glyphs themselves, while GlowFilter (knockout: false)
 * always draws the original source untouched and only adds a halo outward
 * from its edges — that's what keeps the letters reading crisp underneath
 * the glow, not any MSDF/distance-field font technique (this app has
 * never used one; every `Text` here is Pixi's ordinary Canvas-rasterized
 * text, see this class's own module-level doc comment).
 */
const GLOW_PULSE_MIN = 1.4;
const GLOW_PULSE_MAX = 3.4;
const GLOW_PULSE_SPEED = 0.0024;
const GLOW_DISTANCE = 10;
const GLOW_QUALITY = 0.3;

/**
 * The live input field's own "pop" — the whole typed line (not per
 * character: splitting the *source string* into independent glyphs, e.g.
 * PixiJS v8.11+'s own `SplitText`, was tried and confirmed live to shape
 * every Arabic letter in isolation, breaking every join — see
 * refreshInputVisual()'s own doc comment) scales from
 * INPUT_BOUNCE_MIN_SCALE up to 1 via easeOutBounce() every time a
 * keystroke actually *adds* characters (not on deletion — see
 * triggerInputBounce()). `text.origin` (Container's real v8 property,
 * distinct from `pivot`: changing it re-centers the scale pivot without
 * moving the object's own position) is recomputed to the text's own
 * current visual center on every trigger, so the pop reads as growing
 * outward from the middle of whatever's currently typed rather than from
 * the fixed right-edge anchor corner. `inputGlow`'s outerStrength is
 * driven by the exact same per-frame `eased` value as the scale (see
 * syncInputBounce()), so the two are mathematically locked together, not
 * merely started at the same time — glow brightens exactly as the pop
 * grows and settles back to its own resting level the instant the bounce
 * finishes.
 */
const INPUT_BOUNCE_MIN_SCALE = 0.8;
const INPUT_BOUNCE_DURATION_MS = 220;
const INPUT_GLOW_BASE = 0.6;
const INPUT_GLOW_BOOST = 2.6;

/**
 * "الخروج الدرامي" — a deleted character bursts into a handful of embers
 * instead of just vanishing. Reuses `Particle` (src/fireworks/Particle.ts)
 * as-is rather than a parallel particle system: it already renders through
 * two `ParticleContainer`s (trail + core, additive-blended, the exact
 * mechanism FireworksSystem.ts's own bursts use), already fades via alpha
 * and falls via gravity every frame, and already pools cleanly (`kill()`
 * hides instead of destroying — see that class's own doc comment) — the
 * same object, the same texture, the same battle-tested per-frame cost as
 * every rocket burst already on screen elsewhere in this app. `sparkPool`
 * below is this class's *own* pool (a fresh Particle per slot the very
 * first time it's needed, reused forever after), independent of
 * FireworksSystem's — TextComposer has no reference to that instance and
 * doesn't need one for a two-container, ~12-particle effect this small.
 */
const DELETE_SPARK_COUNT_MIN = 10;
const DELETE_SPARK_COUNT_MAX = 15;
const DELETE_SPARK_LIFE_MIN = 26;
const DELETE_SPARK_LIFE_MAX = 46; // frames — well under 60 (~1s at 60fps), per the "less than a second" requirement
/** Sized to actually read as a burst against the input pill's own busy background (small glyphs, gold glow) — not the microscopic 2-3px a literal "one burnt character" scale would give, which live-testing showed was nearly invisible. */
const DELETE_SPARK_SIZE_MIN = 5;
const DELETE_SPARK_SIZE_MAX = 8;

/** Plain glass chrome, matching HeaderBar's own back/home buttons — not part of the gold identity, which belongs to content (the effect frames), not navigation. */
const BACK_BG_COLOR = 0xffffff;
const BACK_BG_ALPHA = 0.06;
const BACK_ICON_TINT = 0xe5e7eb;
const BACK_ICON_SIZE = 18;
const BACK_ICON_SOURCE_SIZE = 40;
/** Real Pixi hitArea per finger — the visible circle stays BACK_DIAMETER (34px), the tappable area is still a generous 44x44 floor. */
const BACK_HIT_SIZE = 44;

/**
 * The input field's genuine Pixi visuals — text, placeholder, and a
 * blinking gold caret, all real `Text`/`Graphics` on `app.stage`. See
 * buildGhostInput() for the hidden native `<input>` that feeds `this.text`
 * (and therefore this display) its characters via the OS's own keyboard.
 */
const INPUT_FONT_SIZE = 15;
/** Explicit, not left to Pixi's own fontSize-based default — multi-line spacing has to be predictable since refreshInputVisual() computes the vertical auto-scroll/caret position from it directly. */
const INPUT_LINE_HEIGHT = Math.round(INPUT_FONT_SIZE * 1.3);
const INPUT_TEXT_COLOR = 0xffe9b3;
/** Same gold/fire identity as the text itself — "وكأن الحرف نفسه قد احترق". */
const DELETE_SPARK_COLORS = [EFFECT_GOLD, 0xffb04c, INPUT_TEXT_COLOR];
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
interface ComposeModeEntry {
  mode: RowMode;
  icon: IconName;
  label: string;
  stackable: boolean;
}
const COMPOSE_MODE_ENTRIES: ComposeModeEntry[] = [
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
const MODE_ICON_SIZE_SOURCE = 28;
const MODE_ICON_SIZE = 22;
const MODE_METALLIC_TOP = 0x4a3a18;
const MODE_METALLIC_BOTTOM = 0x1a1408;
const MODE_METALLIC_TOP_ACTIVE = 0x8a6a28;
const MODE_METALLIC_BOTTOM_ACTIVE = 0x2c2008;
const MODE_GLOW_BASE = 0.5;
const MODE_GLOW_ACTIVE = 1.4;
const MODE_GLOW_TAP_BOOST = 2.2;
const MODE_BOUNCE_MIN_SCALE = 0.85;
const MODE_BOUNCE_DURATION_MS = 260;
const MODE_ROW_MARGIN_TOP = 14;

/**
 * "الفتيل المشتعل تحت النص" — a glowing rope (real `Graphics`, redrawn
 * every frame it's visible so it always matches the input text's own
 * current width exactly, never a stale cached shape) spanning the input
 * text, with a bright ember sliding back and forth along it
 * (Math.sin-driven off `ticker.lastTime`, the same pulse technique
 * syncPreviewGlow() already uses) and — every FUSE_EMBER_SPAWN_INTERVAL_MS
 * or so — a single small spark peeling off the ember, reusing this class's
 * *own* delete-spark Particle pool (sparkTrailsContainer/sparkCoresContainer
 * /getPooledSparkParticle()) rather than a third parallel particle system.
 */
/** Bright enough to read against the composer's own near-black background — a literal rope-brown was tried first and live-tested nearly invisible there. */
const FUSE_ROPE_COLOR = 0xb08040;
const FUSE_ROPE_WIDTH = 3;
/** Stays inside EFFECTS_MARGIN_TOP's own 10px gap — see syncFuseEffect()'s own doc comment on why ropeY anchors to TOPBAR_HEIGHT rather than the caret line. */
const FUSE_ROPE_GAP_BELOW_TEXT = 5;
const FUSE_EMBER_COLOR = 0xfff2c2;
const FUSE_EMBER_RADIUS = 3.5;
const FUSE_EMBER_GLOW = 2.4;
const FUSE_EMBER_SPEED = 0.0016;
const FUSE_EMBER_SPAWN_INTERVAL_MS = 140;

/**
 * "سحابة دخان ذهبية" — unlike the other three ComposeMode entries, this one
 * has no visible effect anywhere in the composer at all. A real, corrected
 * requirement: the effect must not launch until the real show actually
 * starts (previously it animated the still-idle control-box preview
 * immediately on commit, well before "ابدأ العرض" — confirmed live as
 * wrong). `smokeCloudActive`/`committedSmokeActive` here only carry the
 * player's choice through `consumeForReveal()`'s returned `TextRevealConfig`
 * (see that method's own doc comment) — the actual drift/blur playback
 * lives entirely in `TextReveal.ts`'s own `smokeCloud` option, driven off
 * the real reveal's own settled text object, since that's the only object
 * that (a) still exists once the show starts and (b) stays on screen for
 * the rest of it. `previewText` itself never touches this effect.
 */

const PLACEHOLDER_TEXT = 'اكتب عبارتك هنا';
const PLACEHOLDER_COLOR = 0xffffff;
const PLACEHOLDER_ALPHA = 0.4;
const CURSOR_WIDTH = 2;
const CURSOR_HEIGHT = 20;
const CURSOR_GAP = 3;
/** Standard OS caret blink interval (matches Chrome/Android's own ~530ms default). */
const CURSOR_BLINK_MS = 530;
/** The Pixi hitArea is deliberately taller than the visible 36px pill — same 44px-floor rule as every other tappable control this session. */
const INPUT_HIT_HEIGHT = 44;

function effectFrameFilters(): (AdvancedBloomFilter | DropShadowFilter)[] {
  return [
    new AdvancedBloomFilter({ threshold: 0.3, blur: 3, quality: 4, bloomScale: 1.1, brightness: 1.05 }),
    new DropShadowFilter({ color: 0x000000, alpha: 0.45, blur: 2, offset: { x: 0, y: 2 } }),
  ];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Standard "ease out bounce" (easings.net) — a ball dropped and settling, three diminishing bounces, never overshooting past 1. `t` and the return value are both 0..1. */
function easeOutBounce(t: number): number {
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
function diffChangedRange(shorter: string, longer: string): { start: number; end: number } {
  if (longer.length <= shorter.length) return { start: 0, end: 0 };
  const maxPrefix = Math.min(shorter.length, longer.length);
  let prefix = 0;
  while (prefix < maxPrefix && shorter[prefix] === longer[prefix]) prefix++;
  const maxSuffix = Math.min(shorter.length, longer.length) - prefix;
  let suffix = 0;
  while (suffix < maxSuffix && shorter[shorter.length - 1 - suffix] === longer[longer.length - 1 - suffix]) suffix++;
  return { start: prefix, end: longer.length - suffix };
}

/**
 * Free-text composing flow for the "T" icon: a live top input + a golden
 * mode row (fuse/spark-eraser/spring/smoke-cloud — see ComposeMode/RowMode's
 * own doc comments), a back arrow that closes all of that and reveals the
 * player's real text in a draggable + pinch-resizable + rotatable control
 * box, and tapping outside commits it (bare text, no chrome) at whatever
 * position/scale/rotation was left. Tapping the committed text later reopens
 * this whole flow pre-filled. Position/scale/rotation persist in memory for
 * as long as the mood instance lives (see fireworksMood.ts's module doc).
 * There is no reveal-effect picker here — the real show always reveals via
 * `CharacterReveal` (see TextReveal.ts), the sole reveal path.
 *
 * Every visible pixel of this class is genuine Pixi: the back button, the
 * input field (background pill, live text, placeholder, blinking gold
 * caret, the horizontal-scroll mask/pan from refreshInputVisual()), the mode
 * row, the control box (border + two dedicated corner handles), and the
 * full-screen "tap outside to commit" backdrop are all
 * `Graphics`/`Container`/`Text` objects living on `app.stage`, positioned
 * via Pixi's own `position`/`rotation` — never CSS, never DOM.
 *
 * Typing itself is the one deliberate exception: `ghostInput` (see
 * buildGhostInput()) is a real `<input>` element, invisible and positioned
 * exactly over the Pixi input pill, focused on tap so the device's own OS
 * keyboard opens — autocorrect, predictive text, voice input, and every
 * other native typing feature the platform provides work exactly as they
 * would in any other app. Its `input` event is the only bridge into Pixi:
 * `this.text = ghostInput.value` feeds the same `refreshInputVisual()`
 * pipeline a native-canvas keyboard would have. This is a real, explicit
 * architectural trade against an earlier revision of this class, which had
 * zero DOM at the cost of every one of those OS features — see
 * buildGhostInput()'s own doc comment for the reasoning.
 *
 * The control box (border + rotate/resize handles) is not drawn by this
 * class at all — it is `Transformer.ts`'s sole responsibility, a standalone
 * widget with no knowledge of text/effects/typing. `openControlBox()`
 * constructs a `Transformer` fresh for each editing session and
 * `closeControlBox()` `destroy()`s it the moment editing ends (commit or
 * tap-outside): no gated/idle listener for it is ever left running while
 * nothing is being edited. This class stays the single source of truth for
 * `posX`/`posY`/`scale`/`rotation`; the Transformer only ever reports
 * gesture results back up via callbacks (`onMove`/`onRotate`/`onScale`,
 * see `transformerTarget()`/`syncTransforms()`) and redraws itself against
 * whatever state this class hands it.
 */
export class TextComposer {
  private readonly deps: TextComposerDeps;
  private readonly composerContainer: Container;
  /** Swallows taps that land in the gaps between buttons/frames — see the constructor's doc comment where it's built. */
  private readonly catchAll: Graphics;
  private readonly backButton: { root: Container; bg: Graphics };
  private readonly inputField: InputFieldObj;
  /** The one real DOM element in this class — see buildGhostInput()'s own doc comment. */
  private readonly ghostInput: HTMLTextAreaElement;
  /** Set each time layoutComposer() runs — the input pill's own available width, used by refreshInputVisual()'s auto-scroll. */
  private inputFieldWidth = 0;
  /** Current pan offset applied to inputField.scrollGroup.x — 0 is fully right-aligned (resting position, the last line's own trailing edge at the window's right edge); positive values shift the group right, revealing more of that line's left (most-recently-typed) end. Clamped to [0, inputMaxScrollX]. */
  private inputScrollX = 0;
  /** How far inputScrollX can go — 0 once the last line fits the pill outright; recomputed every refreshInputVisual() call from that line alone (not the whole multi-line block). */
  private inputMaxScrollX = 0;
  /** Current pan offset applied to inputField.scrollGroup.y — 0 is fully bottom-aligned (the last line visible, every earlier line clipped above by `mask`, exactly the same free "auto-follow" effect right-anchoring already gives the X axis); positive values shift the group down, revealing earlier lines. Clamped to [0, inputMaxScrollY]. */
  private inputScrollY = 0;
  /** How far inputScrollY can go — 0 once every line already fits the pill's one-line-tall window; recomputed every refreshInputVisual() call from the full block's height. */
  private inputMaxScrollY = 0;
  private inputDragPointerId: number | null = null;
  private inputDragStartX = 0;
  private inputDragStartY = 0;
  private inputDragStartScrollX = 0;
  private inputDragStartScrollY = 0;
  private cursorBlinkTimer: TickerTimerHandle | undefined;
  /** `this.text` as of the previous refreshInputVisual() call — triggerInputBounce()'s baseline for telling an addition (pop-worthy) apart from a deletion (not). */
  private previousInputTextForBounce = '';
  /** `ticker.lastTime` the current pop started at, or -1 once it's settled (skipped every frame after) — see INPUT_BOUNCE_* constants' own doc comment. */
  private inputBounceStart = -1;
  /** The live input field's own halo, synced frame-for-frame to the pop (see syncInputBounce()) — a separate instance from previewGlow, since it lives on a different Text object. */
  private readonly inputGlow: GlowFilter;
  /** Deleted-character embers — additive-blended, matching every rocket burst's own trail/core split elsewhere in this app (see DELETE_SPARK_* constants' own doc comment). Unclipped (added to worldContainer, not inside the input pill's scrollGroup/mask — see the constructor's own doc comment on why worldContainer specifically), so a burst is free to spill past the tiny pill. */
  private readonly sparkTrailsContainer: ParticleContainer;
  private readonly sparkCoresContainer: ParticleContainer;
  /** Currently-alive spark particles, updated/culled every frame — see syncDeleteSparks(). */
  private sparkParticles: Particle[] = [];
  /** Dead sparks ready for immediate reuse — see spawnDeleteSparks(); never destroyed, only ever `kill()`ed and pushed back here. */
  private readonly sparkDeadPool: Particle[] = [];
  /**
   * Which second-row icon (if any) is active — see ComposeMode's own doc
   * comment. Gates the input bounce, the delete-spark burst, and the fuse
   * effect. Reset to `'none'` by confirmAndOpenControlBox() every commit —
   * once a mode has actually been used (applied to the just-committed
   * text), reopening the composer for the *next* word starts every icon
   * back at off rather than carrying the previous word's choice forward as
   * if it were still selected.
   */
  private composeMode: ComposeMode = 'none';
  private readonly composeModeFrames: ComposeModeFrameObj[];
  /** `ticker.lastTime` the current tap's bounce+glow-boost spike started at, or -1 once it's settled — same eased-decay pattern as inputBounceStart. Keyed by frame so only the tapped icon spikes, not every frame in the row. */
  private modeBounceStart = -1;
  private modeBounceFrame: ComposeModeFrameObj | null = null;
  /** The lit-fuse rope + its traveling ember — real Graphics, redrawn every frame it's visible (see syncFuseEffect()). Never added/removed from the tree; `visible` toggles with composeMode/hasText instead, avoiding churn on every mode switch. */
  private readonly fuseRope: Graphics;
  private readonly fuseEmber: Graphics;
  private readonly fuseEmberGlow: GlowFilter;
  private fuseEmberSpawnAccumulator = 0;
  /**
   * The row's one stackable/independent toggle — see RowMode's own doc
   * comment. Reset to `false` by confirmAndOpenControlBox() every commit,
   * same as `composeMode` — see that field's own doc comment. Does *not*
   * animate `previewText` at all (see this class's own smoke-cloud doc
   * comment on why: the effect only actually plays once the real show
   * starts, on the real reveal's own text object — see
   * TextReveal.ts's own `smokeCloud` option). This field, and
   * `committedSmokeActive` below, exist purely to carry the player's choice
   * through to `consumeForReveal()`'s returned `TextRevealConfig`.
   */
  private smokeCloudActive = false;
  /** Snapshot of `smokeCloudActive` taken at the exact moment of commit (see confirmAndOpenControlBox()) — what consumeForReveal() actually reads once the control box has been shown at least once for the current text, since `smokeCloudActive` itself gets reset for the *next* word by then. */
  private committedSmokeActive = false;
  private readonly previewText: Text;
  /** The committed text's pulsing halo — one instance, reused every frame (see GLOW_* constants' own doc comment); never recreated per-tick. */
  private readonly previewGlow: GlowFilter;
  private readonly baseFontSize: number;

  /** Full-screen, invisible-but-hit-testable — catches "tap outside the box" to commit. Sits directly under the Transformer's own box/handles on `uiContainer` so they always win the hit test over it. */
  private readonly backdrop: Graphics;

  private text = SAMPLE_PHRASE;
  private posX: number;
  private posY: number;
  private scale = 1;
  /** Radians — see TextRevealConfig's doc comment for the convention. */
  private rotation = 0;
  private hasCommittedOnce = false;
  /** Exists only between openControlBox() and closeControlBox() — see Transformer.ts's own doc comment for why nothing here keeps a permanent gated listener for it. */
  private transformer: Transformer | null = null;

  constructor(deps: TextComposerDeps) {
    this.deps = deps;

    const { width, height } = deps.app.screen;
    this.posX = width / 2;
    this.posY = height / 2;
    this.baseFontSize = Math.max(36, Math.min(width, height) * 0.09);

    this.previewText = new Text({ text: this.text, style: this.textStyle() });
    this.previewText.anchor.set(0.5);
    this.previewText.visible = false;
    this.previewText.eventMode = 'static';
    this.previewText.cursor = 'pointer';
    this.previewGlow = new GlowFilter({ distance: GLOW_DISTANCE, outerStrength: GLOW_PULSE_MIN, innerStrength: 0, color: EFFECT_GOLD, quality: GLOW_QUALITY });
    this.previewText.filters = [this.previewGlow];
    deps.app.ticker.add((ticker) => this.syncPreviewGlow(ticker));

    this.previewText.on('pointerdown', (event) => {
      event.stopPropagation();
      this.open();
    });
    deps.worldContainer.addChild(this.previewText);
    this.syncPreviewTransform();

    this.composerContainer = new Container();
    this.composerContainer.visible = false;
    deps.uiContainer.addChild(this.composerContainer);

    // A silent catch-all sitting behind every other child: individual
    // buttons/frames only claim their own hitArea, so the *gaps* between
    // them (the row/column gaps, the space below the last row) belong to
    // nobody and would otherwise fall straight through to app.stage's
    // tap-to-fire rocket listener underneath — the old DOM `#mzj-text-composer`
    // div never had this problem since a block-level element absorbs every
    // tap inside its own box by default. This replicates that: real drawn
    // geometry (Pixi hit-tests a Graphics against its own shape when no
    // explicit hitArea is set), sized to the composer's full content box in
    // layoutComposer(), doing nothing but swallowing the tap.
    this.catchAll = new Graphics();
    this.catchAll.eventMode = 'static';
    this.catchAll.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.composerContainer.addChild(this.catchAll);

    this.inputGlow = new GlowFilter({ distance: GLOW_DISTANCE, outerStrength: INPUT_GLOW_BASE, innerStrength: 0, color: EFFECT_GOLD, quality: GLOW_QUALITY });
    this.inputField = this.buildInputField();
    deps.app.ticker.add((ticker) => this.syncInputBounce(ticker));
    this.composerContainer.addChild(this.inputField.root);

    const sparkTexture = getParticleTexture(deps.app);
    this.sparkTrailsContainer = new ParticleContainer({
      texture: sparkTexture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: true, vertex: true, uvs: false, color: true },
    });
    this.sparkCoresContainer = new ParticleContainer({
      texture: sparkTexture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: false, vertex: true, uvs: false, color: true },
    });
    // Deliberately parented under `worldContainer`, not the sibling
    // `uiContainer` every other piece of this class's own chrome lives in —
    // confirmed live (particles spawn and age correctly in the model, zero
    // pixels ever hit the screen) that a `ParticleContainer` doesn't work
    // inside `uiContainer`: it's a render group (`{ isRenderGroup: true }`,
    // see fireworksMood.ts's own doc comment) cached into its own render
    // target, rebuilt only when Pixi's ordinary dirty-propagation fires
    // (children added/removed, transforms changed). A live particle's own
    // per-frame motion is deliberately *outside* that system — `Particle`
    // mutates plain x/y/alpha properties on its pooled `PixiParticle`s every
    // tick (see Particle.ts's own update()), relying on `ParticleContainer`'s
    // separate "dynamicProperties" fast path (re-read fresh every render,
    // no dirty flag) to reach the screen — which only actually runs when
    // something *does* re-render that subtree every frame, true for
    // `worldContainer` (never cached, redrawn continuously for the fireworks
    // simulation itself) but not for a cached render group. `FireworksSystem`
    // hit this same interaction once already and settled on a plain
    // (non-render-group) container for exactly this reason (see its own
    // constructor's doc comment) — same fix, applied here by picking the
    // sibling layer that was already plain rather than by changing
    // `uiContainer` itself, which is shared, app-wide chrome this class
    // doesn't own. Sparks are purely transient composing-time feedback
    // (dead within under a second — see DELETE_SPARK_LIFE_MAX), and the
    // composer and the snapshot-capable immersive viewing mode are mutually
    // exclusive (committing text closes the composer before that mode is
    // ever reachable), so living in `worldContainer` never risks one
    // leaking into a captured snapshot.
    deps.worldContainer.addChild(this.sparkTrailsContainer, this.sparkCoresContainer);
    deps.app.ticker.add((ticker) => this.syncDeleteSparks(ticker));

    this.backButton = this.buildBackButton();

    this.composeModeFrames = COMPOSE_MODE_ENTRIES.map((entry) => this.buildComposeModeFrame(entry.mode, entry.icon, entry.label, entry.stackable));
    for (const frame of this.composeModeFrames) this.composerContainer.addChild(frame.root);
    this.wireComposeModeButtons();
    deps.app.ticker.add((ticker) => this.syncComposeModeFrames(ticker));

    // Fuse rope + ember — see FUSE_* constants' own doc comment. Added once,
    // hidden by default; syncFuseEffect() owns visibility/redraw entirely.
    this.fuseRope = new Graphics();
    this.fuseRope.visible = false;
    this.composerContainer.addChild(this.fuseRope);
    this.fuseEmberGlow = new GlowFilter({ distance: GLOW_DISTANCE, outerStrength: FUSE_EMBER_GLOW, innerStrength: 0.4, color: FUSE_EMBER_COLOR, quality: GLOW_QUALITY });
    this.fuseEmber = new Graphics().circle(0, 0, FUSE_EMBER_RADIUS).fill(FUSE_EMBER_COLOR);
    this.fuseEmber.filters = [this.fuseEmberGlow];
    this.fuseEmber.visible = false;
    this.composerContainer.addChild(this.fuseEmber);
    deps.app.ticker.add((ticker) => this.syncFuseEffect(ticker));

    // Added last, deliberately — Pixi renders later-added children on top,
    // so this guarantees the back arrow always sits visually above the mode
    // row and the fuse rope/ember, regardless of whatever any of those are
    // doing (a bounce mid-pop, the fuse ember riding past its own row). Per
    // the standing "السهم هو القائد العام" rule: no mode icon may ever
    // visually cover or intercept it, now or after any future addition to
    // this composer.
    this.composerContainer.addChild(this.backButton.root);

    this.ghostInput = this.buildGhostInput();

    deps.app.renderer.on('resize', () => this.layoutComposer());
    this.layoutComposer();
    this.refreshInputVisual();

    // Full-screen hit target for "tap outside the box commits it" — a
    // near-zero-alpha fill so it's still real drawn geometry (Pixi hit-tests
    // a Graphics against its own shape when no explicit `hitArea` is set),
    // matching how `app.stage.hitArea` itself is kept in sync on resize
    // (see fireworksMood.ts).
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.001 });
    this.backdrop.eventMode = 'static';
    this.backdrop.visible = false;
    this.backdrop.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.commit();
    });
    deps.uiContainer.addChild(this.backdrop);
    deps.app.renderer.on('resize', () => {
      const screen = deps.app.screen;
      this.backdrop.clear().rect(0, 0, screen.width, screen.height).fill({ color: 0x000000, alpha: 0.001 });
    });

    this.wireBack();

    deps.app.stage.on('pointermove', this.handleInputPointerMove);
    deps.app.stage.on('pointerup', this.handleInputPointerEnd);
    deps.app.stage.on('pointerupoutside', this.handleInputPointerEnd);
  }

  /** Opens the composer pre-filled with whatever text is currently set — used by the T icon and by tapping the committed text. The OS keyboard only opens once the player actually taps the input pill (see buildGhostInput()), not automatically here. */
  open(): void {
    this.closeControlBox();
    this.previewText.visible = false;
    this.refreshInputVisual();
    this.composerContainer.visible = true;
    this.deps.onComposingChange(true);
  }

  /**
   * Returns the config beginShow() should reveal with, and hides the static
   * preview so the real animated reveal can take over without the two
   * overlapping. Null if the player never actually went through the
   * composer at all this session — callers should fall back to their own
   * default in that case.
   *
   * `smokeCloud` is where the smoke-cloud mode's choice actually gets used
   * — deliberately not in the composer at all (see that field's own doc
   * comment: the effect must never animate before the real show starts).
   * Which field is authoritative depends on whether the control box was
   * ever actually shown for *this* text: if `previewText.visible` is
   * already true, confirmAndOpenControlBox() already ran and reset the
   * live `smokeCloudActive` for whatever comes next, so `committedSmokeActive`
   * (its snapshot) is the real answer. If it's still false, the player
   * pressed "ابدأ العرض" without ever tapping the composer's own arrow —
   * confirmAndOpenControlBox() never ran, so the live `smokeCloudActive`
   * itself is still the current, uncommitted choice for this text.
   */
  consumeForReveal(): TextRevealConfig | null {
    const smokeCloud = this.previewText.visible ? this.committedSmokeActive : this.smokeCloudActive;
    // Defensive: the show can start (via the header's always-available
    // "ابدأ العرض") while the composer or control box is still open.
    this.composerContainer.visible = false;
    this.ghostInput.blur();
    this.closeControlBox();
    this.previewText.visible = false;
    if (!this.hasCommittedOnce) return null;
    return { text: this.text, x: this.posX, y: this.posY, fontScale: this.scale, rotation: this.rotation, smokeCloud };
  }

  private textStyle(): TextStyle {
    return new TextStyle({
      fontFamily: 'system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: Math.round(this.baseFontSize * this.scale),
      fontWeight: '800',
      fill: 0xffe9b3,
      stroke: { color: 0x2a1400, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3 },
      align: 'center',
    });
  }


  /**
   * Unlike the back arrow (whose tap always commits and closes the
   * composer), tapping a mode icon toggles it and keeps composing —
   * tapping the already-active one deselects it back to `'none'`, tapping
   * a different one switches directly (see ComposeMode's own doc comment).
   * `stackable` (currently just `'smoke-cloud'` — see RowMode's own doc
   * comment) flips its own independent boolean instead of touching
   * `composeMode` at all, so it can be on at the same time as any of the
   * other three. Every tap, active-going or not, still fires the
   * micro-bounce/glow spike on *that* frame — physical feedback that the
   * press registered, whether it turned the mode on or off.
   */
  private wireComposeModeButtons(): void {
    for (const frame of this.composeModeFrames) {
      frame.root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
      frame.root.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        this.deps.audio.playUiClick();
        if (frame.stackable) {
          this.smokeCloudActive = !this.smokeCloudActive;
        } else {
          this.composeMode = this.composeMode === frame.mode ? 'none' : (frame.mode as ComposeMode);
        }
        this.modeBounceStart = this.deps.app.ticker.lastTime;
        this.modeBounceFrame = frame;
        this.syncComposeModeFrames(this.deps.app.ticker);
      });
    }
  }

  /**
   * Per-frame visual sync for the mode row — cheap even when nothing is
   * mid-bounce: the eased spike only computes for `modeBounceFrame`, every
   * other frame just re-reads its own static idle/active glow level.
   * `MODE_METALLIC_*ACTIVE` swaps the whole gradient (not just the stroke,
   * unlike the effects bar) — this row's own "غامق ذهبي إلى مشع" identity —
   * and the border stroke color itself follows the *live* glow strength
   * (lerped between the same two stops) so the metal itself, not just the
   * halo around it, visibly warms up during the tap spike.
   */
  private syncComposeModeFrames(ticker: Ticker): void {
    let spike = 0;
    if (this.modeBounceStart >= 0) {
      const t = Math.min(1, (ticker.lastTime - this.modeBounceStart) / MODE_BOUNCE_DURATION_MS);
      const eased = easeOutBounce(t);
      if (this.modeBounceFrame) {
        this.modeBounceFrame.root.scale.set(MODE_BOUNCE_MIN_SCALE + eased * (1 - MODE_BOUNCE_MIN_SCALE));
      }
      spike = (1 - eased) * MODE_GLOW_TAP_BOOST;
      if (t >= 1) {
        this.modeBounceFrame?.root.scale.set(1);
        this.modeBounceStart = -1;
        this.modeBounceFrame = null;
        spike = 0;
      }
    }

    for (const frame of this.composeModeFrames) {
      const active = frame.stackable ? this.smokeCloudActive : frame.mode === this.composeMode;
      const isBouncing = frame === this.modeBounceFrame;
      frame.glow.outerStrength = (active ? MODE_GLOW_ACTIVE : MODE_GLOW_BASE) + (isBouncing ? spike : 0);

      const fill = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        textureSpace: 'local',
        colorStops: active
          ? [{ offset: 0, color: MODE_METALLIC_TOP_ACTIVE }, { offset: 1, color: MODE_METALLIC_BOTTOM_ACTIVE }]
          : [{ offset: 0, color: MODE_METALLIC_TOP }, { offset: 1, color: MODE_METALLIC_BOTTOM }],
      });
      frame.border
        .clear()
        .roundRect(-PREVIEW_W / 2, -PREVIEW_H / 2, PREVIEW_W, PREVIEW_H, PREVIEW_RADIUS)
        .fill(fill)
        .stroke({ width: 1.5, color: EFFECT_GOLD, alpha: active ? FRAME_BORDER_ACTIVE_ALPHA : FRAME_BORDER_IDLE_ALPHA })
        .roundRect(-PREVIEW_W / 2 + 3, -PREVIEW_H / 2 + 3, PREVIEW_W - 6, PREVIEW_H * 0.42, PREVIEW_RADIUS - 3)
        .fill({ color: 0xffe9b3, alpha: active ? 0.14 : 0.06 });
      frame.label.style = new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: LABEL_FONT_SIZE,
        fontWeight: active ? '700' : '400',
        fill: active ? LABEL_ACTIVE_COLOR : LABEL_IDLE_COLOR,
      });
      frame.label.alpha = active ? 1 : LABEL_IDLE_ALPHA;
    }
  }

  /**
   * One compose-mode row item — a rounded golden-metallic frame with a
   * centered icon glyph and its own dedicated GlowFilter (see MODE_*
   * constants' own doc comment).
   *
   * `root.origin.set(0, 0)` is here on purpose, not as a no-op: `origin`
   * (Container's real v8 property — a `PointData`/number, *not* a string;
   * there's no `'center'` shorthand) is what makes `root.scale`'s pivot
   * point-preserving rather than corner-preserving. It happens to already
   * equal Pixi's own default pivot (0,0) here, because every piece of this
   * frame's own content (border/glyph/label below) is drawn symmetric
   * around local (0,0) already — so this line changes nothing today, but
   * states the actual invariant the bounce in syncComposeModeFrames()
   * relies on explicitly, rather than leaving "why does scaling this not
   * drift its position" to an accident of how the geometry happens to be
   * centered.
   */
  private buildComposeModeFrame(mode: RowMode, icon: IconName, labelText: string, stackable: boolean): ComposeModeFrameObj {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-FRAME_HIT_WIDTH / 2, FRAME_HIT_TOP, FRAME_HIT_WIDTH, FRAME_HIT_HEIGHT);
    root.origin.set(0, 0);

    const glow = new GlowFilter({ distance: GLOW_DISTANCE, outerStrength: MODE_GLOW_BASE, innerStrength: 0, color: EFFECT_GOLD, quality: GLOW_QUALITY });
    const border = new Graphics();
    border.filters = [glow];
    root.addChild(border);

    const glyph = new Sprite();
    glyph.anchor.set(0.5);
    glyph.tint = EFFECT_GOLD;
    glyph.width = MODE_ICON_SIZE;
    glyph.height = MODE_ICON_SIZE;
    root.addChild(glyph);
    void iconTexture(icon, MODE_ICON_SIZE_SOURCE, '#ffffff').then((texture) => {
      glyph.texture = texture;
    });

    const label = new Text({ text: labelText, style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: LABEL_FONT_SIZE, fill: LABEL_IDLE_COLOR }) });
    label.anchor.set(0.5, 0);
    label.position.set(0, PREVIEW_H / 2 + LABEL_GAP);
    root.addChild(label);

    return { mode, stackable, root, border, glyph, glow, label };
  }

  /**
   * Redraws the fuse rope + slides its ember every frame while
   * `composeMode === 'fuse'` and there's text to run it under; hidden (and
   * cheaply skipped) otherwise. The rope spans the *visible* text block's
   * own on-screen extent — measured the same way refreshInputVisual()
   * already sizes the scroll window, so the rope never runs wider than what
   * the player can actually see (multi-line text keeps it pinned under just
   * the *last* line, which is always the one at the fixed bottom anchor).
   * The ember rides a Math.sin oscillation between the rope's own two ends
   * (ticker.lastTime-driven, unaccumulated — same pulse technique
   * syncPreviewGlow() uses) and periodically peels off a single real ember
   * via this class's own delete-spark particle pool.
   */
  private syncFuseEffect(ticker: Ticker): void {
    const active = this.composeMode === 'fuse' && this.text.length > 0;
    this.fuseRope.visible = active;
    this.fuseEmber.visible = active;
    if (!active) return;

    const availWidth = Math.max(0, this.inputFieldWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    const lines = this.text.split('\n');
    const lastLine = lines[lines.length - 1];
    const lastLineWidth = lastLine.length ? CanvasTextMetrics.measureText(lastLine, this.inputField.text.style).width : 0;
    const ropeWidth = Math.min(availWidth, lastLineWidth);

    // Runs directly under the *visible glyphs*, not the pill's own center —
    // the text is right-anchored (see refreshInputVisual()'s own doc
    // comment on the RTL layout), so its right edge always sits at local
    // x = availWidth / 2 within inputField.root, same reference
    // refreshInputVisual() itself positions text.position.x from. fuseRope
    // is composerContainer's own child (a sibling of inputField.root, not
    // its child), so that local x needs inputField.root's own position
    // added back in to land in composerContainer's space.
    const textRightEdgeX = this.inputField.root.position.x + availWidth / 2;
    const ropeCenterX = textRightEdgeX - ropeWidth / 2;
    const ropeHalfWidth = ropeWidth / 2;

    // Anchored to the pill's own fixed bottom edge (TOPBAR_HEIGHT), not the
    // caret's own line — multi-line text's *last* line always sits at the
    // same fixed bottom anchor regardless of line count (see
    // refreshInputVisual()'s own doc comment), so the rope's own Y never
    // needs to track it. Sits inside the existing EFFECTS_MARGIN_TOP gap
    // between the topbar and the effects grid below it, not a new one —
    // FUSE_ROPE_GAP_BELOW_TEXT stays comfortably under that gap's own size.
    const ropeY = TOPBAR_HEIGHT + FUSE_ROPE_GAP_BELOW_TEXT;

    this.fuseRope
      .clear()
      .moveTo(ropeCenterX - ropeHalfWidth, ropeY)
      .lineTo(ropeCenterX + ropeHalfWidth, ropeY)
      .stroke({ width: FUSE_ROPE_WIDTH, color: FUSE_ROPE_COLOR, cap: 'round' });

    const emberT = 0.5 + 0.5 * Math.sin(ticker.lastTime * FUSE_EMBER_SPEED);
    const emberX = ropeCenterX - ropeHalfWidth + emberT * (ropeHalfWidth * 2);
    this.fuseEmber.position.set(emberX, ropeY);

    this.fuseEmberSpawnAccumulator += ticker.deltaMS;
    if (this.fuseEmberSpawnAccumulator >= FUSE_EMBER_SPAWN_INTERVAL_MS) {
      this.fuseEmberSpawnAccumulator = 0;
      // fuseEmber's own parent is composerContainer, not inputField.root — see ropeY's own doc comment above on the same space mismatch.
      const global = this.composerContainer.toGlobal({ x: emberX, y: ropeY });
      this.spawnFuseEmber(global.x, global.y);
    }
  }

  /** A single, gentle ember (not a burst — see spawnDeleteSparks() for that) peeling off the traveling fuse point. Same pool as the delete-spark system (see FUSE_* constants' own doc comment). */
  private spawnFuseEmber(x: number, y: number): void {
    const particle = this.getPooledSparkParticle();
    particle.init({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.6 - Math.random() * 0.4,
      color: FUSE_EMBER_COLOR,
      size: 2 + Math.random(),
      life: 20 + Math.random() * 14,
      gravity: 0.06,
      drag: 0.97,
      twinkle: true,
    });
    this.sparkParticles.push(particle);
  }

  private wireBack(): void {
    this.backButton.root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.backButton.root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.deps.audio.playUiClick();
      this.confirmAndOpenControlBox();
    });
  }

  /**
   * Leaves the input and reveals the committed text in its
   * draggable/resizable/rotatable control box — the transition the back
   * arrow triggers.
   *
   * `composeMode`/`smokeCloudActive` reset to their own defaults here —
   * once a mode has actually been used (this commit *is* that use), it has
   * no business still showing "selected" the next time the composer opens
   * for a new word. `committedSmokeActive` is snapshotted from
   * `smokeCloudActive` *before* that reset — consumeForReveal() reads it
   * from there once the real show actually starts (see that method's own
   * doc comment on why the smoke-cloud effect only ever plays then, never
   * on this still-idle control-box preview).
   */
  private confirmAndOpenControlBox(): void {
    this.ghostInput.blur();
    this.composerContainer.visible = false;
    this.text = this.text.trim() ? this.text : SAMPLE_PHRASE;
    this.previewText.text = this.text;
    this.previewText.visible = true;
    this.committedSmokeActive = this.smokeCloudActive;
    this.composeMode = 'none';
    this.smokeCloudActive = false;
    this.syncComposeModeFrames(this.deps.app.ticker);
    this.syncPreviewTransform();
    this.openControlBox();
  }

  /**
   * Builds a fresh `Transformer` for this one editing session — see
   * Transformer.ts's own doc comment for why it is constructed here rather
   * than once up front and merely shown/hidden: no gesture listener for it
   * exists on `app.stage` at all while nothing is being edited.
   * `onMove`/`onRotate`/`onScale` are the only way the Transformer ever
   * changes anything — it reports a gesture result, this class remains the
   * one place `posX`/`posY`/`scale`/`rotation` actually live.
   */
  private openControlBox(): void {
    this.backdrop.visible = true;
    this.transformer = new Transformer(this.deps.app, this.deps.uiContainer, this.transformerTarget(), {
      onMove: (x, y) => {
        this.posX = x;
        this.posY = y;
        this.syncTransforms();
      },
      onRotate: (rotation) => {
        this.rotation = rotation;
        this.syncTransforms();
      },
      onScale: (scale) => {
        this.scale = scale;
        this.syncTransforms();
      },
    });
    this.deps.onComposingChange(true);
  }

  /** Tears the Transformer down completely — see Transformer.destroy()'s own doc comment. */
  private closeControlBox(): void {
    this.backdrop.visible = false;
    this.transformer?.destroy();
    this.transformer = null;
  }

  /** Tapping the backdrop outside the box commits it: chrome disappears, bare text stays at its last position/scale. */
  private commit(): void {
    this.closeControlBox();
    this.hasCommittedOnce = true;
    this.deps.onComposingChange(false);
  }

  private syncPreviewTransform(): void {
    this.previewText.position.set(this.posX, this.posY);
    this.previewText.rotation = this.rotation;
    this.previewText.style = this.textStyle();
  }

  /**
   * Drives the committed text's "breathing" glow — registered once on
   * `deps.app.ticker` in the constructor, gated on `previewText.visible`
   * (the ticker itself is shared and always running, see main.ts, so
   * anything per-mode has to stand down explicitly rather than relying on
   * the ticker being paused). `ticker.lastTime` is a plain millisecond
   * clock the shared ticker already advances every frame — feeding it
   * straight into `Math.sin` needs no timer, no accumulator field, no
   * per-frame allocation: only a single `outerStrength` uniform write on
   * the one `GlowFilter` instance built in the constructor.
   */
  private syncPreviewGlow(ticker: Ticker): void {
    if (!this.previewText.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(ticker.lastTime * GLOW_PULSE_SPEED);
    this.previewGlow.outerStrength = GLOW_PULSE_MIN + pulse * (GLOW_PULSE_MAX - GLOW_PULSE_MIN);
  }

  /**
   * Drives the input field's pop — registered once on `deps.app.ticker` in
   * the constructor, a no-op whenever `inputBounceStart` is idle (-1, the
   * common case) so it costs nothing while the player isn't actively
   * typing. `eased` (easeOutBounce()) feeds *both* `text.scale` and
   * `inputGlow.outerStrength` from the exact same value every frame — see
   * the INPUT_BOUNCE_ and INPUT_GLOW_ constants' own doc comment for why
   * that locks them together rather than merely starting together. The instant
   * the bounce finishes (t >= 1), the glow is explicitly snapped back to
   * its own resting level rather than left at its boosted peak — plain
   * assignment, not eased, since easeOutBounce(1) is exactly 1 and would
   * otherwise leave outerStrength permanently at INPUT_GLOW_BASE +
   * INPUT_GLOW_BOOST once idle.
   */
  private syncInputBounce(ticker: Ticker): void {
    if (this.inputBounceStart < 0) return;
    const elapsed = ticker.lastTime - this.inputBounceStart;
    const t = Math.min(1, elapsed / INPUT_BOUNCE_DURATION_MS);
    if (t >= 1) {
      this.inputField.text.scale.set(1);
      this.inputGlow.outerStrength = INPUT_GLOW_BASE;
      this.inputBounceStart = -1;
      return;
    }
    const eased = easeOutBounce(t);
    this.inputField.text.scale.set(INPUT_BOUNCE_MIN_SCALE + eased * (1 - INPUT_BOUNCE_MIN_SCALE));
    this.inputGlow.outerStrength = INPUT_GLOW_BASE + eased * INPUT_GLOW_BOOST;
  }

  /**
   * Fired from buildGhostInput()'s `input` listener *before* `this.text` is
   * reassigned to `newText` — so `this.text`/`this.inputField.text` here
   * still reflect `oldText`'s own layout, which is exactly what's needed:
   * the deleted character's on-screen position only exists in the *old*
   * layout, not the new (shorter) one. `diffChangedRange(newText, oldText)`
   * (arguments swapped from the "what got inserted" call — see that
   * function's own doc comment) finds the `[start, end)` slice of
   * `oldText` that vanished; `start` is used as the caret index to locate
   * (a multi-character deletion, e.g. selecting a run and pressing
   * Backspace, still gets one burst at the run's own start — the same
   * spot the caret lands at afterward).
   */
  private triggerDeleteSpark(oldText: string, newText: string): void {
    const { start } = diffChangedRange(newText, oldText);
    const lines = oldText.split('\n');
    const { lineIndex, offsetInLine } = this.locateCaretPosition(lines, start);
    const lineText = lines[lineIndex];
    const prefixWidth = offsetInLine ? CanvasTextMetrics.measureText(lineText.slice(0, offsetInLine), this.inputField.text.style).width : 0;

    // Same math as refreshInputVisual()'s own caretLocalX/Y — reproduced
    // here rather than shared since that method reads `this.text` (already
    // reassigned to `newText` by the time it next runs) while this one
    // deliberately measures `oldText`'s layout instead.
    const availWidth = Math.max(0, this.inputFieldWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    const bottomPad = (INPUT_HEIGHT - INPUT_FONT_SIZE) / 2;
    const anchorY = INPUT_HEIGHT / 2 - bottomPad;
    const localX = availWidth / 2 - prefixWidth - CURSOR_GAP;
    const linesFromBottom = lines.length - 1 - lineIndex;
    const localY = anchorY - linesFromBottom * INPUT_LINE_HEIGHT - INPUT_LINE_HEIGHT / 2;

    const global = this.inputField.scrollGroup.toGlobal({ x: localX, y: localY });
    this.spawnDeleteSparks(global.x, global.y);
  }

  /** One dead-pooled Particle (or a fresh one on a genuine pool miss) — see sparkDeadPool's own doc comment. Mirrors FireworksSystem.spawnParticle()'s own pop-or-construct pattern. */
  private getPooledSparkParticle(): Particle {
    return this.sparkDeadPool.pop() ?? new Particle(getParticleTexture(this.deps.app), this.sparkTrailsContainer, this.sparkCoresContainer);
  }

  /** Radial burst of 10-15 embers at a global (x, y) — see this class's own DELETE_SPARK_* doc comment for why Particle/ParticleContainer are reused wholesale rather than built fresh. */
  private spawnDeleteSparks(x: number, y: number): void {
    const count = DELETE_SPARK_COUNT_MIN + Math.floor(Math.random() * (DELETE_SPARK_COUNT_MAX - DELETE_SPARK_COUNT_MIN + 1));
    for (let i = 0; i < count; i++) {
      const particle = this.getPooledSparkParticle();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.4;
      particle.init({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1, // slight upward kick so gravity's own pull down reads clearly
        color: DELETE_SPARK_COLORS[Math.floor(Math.random() * DELETE_SPARK_COLORS.length)],
        size: DELETE_SPARK_SIZE_MIN + Math.random() * (DELETE_SPARK_SIZE_MAX - DELETE_SPARK_SIZE_MIN),
        life: DELETE_SPARK_LIFE_MIN + Math.random() * (DELETE_SPARK_LIFE_MAX - DELETE_SPARK_LIFE_MIN),
        gravity: 0.12, // matches this codebase's own established burst-particle gravity range (see fireworks/patterns/*.ts)
        drag: 0.97,
        twinkle: true,
      });
      this.sparkParticles.push(particle);
    }
  }

  /** Ages/culls every live delete-spark — same filter-and-recycle loop FireworksSystem.update() itself uses for its own particle pool. Gated on an empty array so an idle composer costs nothing per frame. */
  private syncDeleteSparks(ticker: Ticker): void {
    if (this.sparkParticles.length === 0) return;
    this.sparkParticles = this.sparkParticles.filter((particle) => {
      const alive = particle.update(ticker.deltaTime);
      if (!alive) {
        particle.kill();
        this.sparkDeadPool.push(particle);
      }
      return alive;
    });
  }

  /** A plain snapshot of everything the Transformer needs to draw itself — `previewText.width/height` already reflect the current `scale` (see textStyle(), which drives fontSize from it), so the border always matches the text's real on-screen size with no separate scaling step of its own. */
  private transformerTarget(): TransformerTarget {
    return {
      x: this.posX,
      y: this.posY,
      rotation: this.rotation,
      scale: this.scale,
      contentWidth: this.previewText.width,
      contentHeight: this.previewText.height,
    };
  }

  /** Called after any gesture callback (move/rotate/scale) changes posX/posY/rotation/scale: repaints the actual text, then hands the Transformer a fresh snapshot to redraw its border/handles against. */
  private syncTransforms(): void {
    this.syncPreviewTransform();
    this.transformer?.update(this.transformerTarget());
  }

  /**
   * The text field itself: a glass pill (background matches the old
   * `.mzj-text-composer-input`'s `rgba(255,255,255,0.08)`), the live typed
   * text (gold `#ffe9b3`, same as before), a dimmed placeholder shown only
   * while empty, and a blinking gold caret with the same
   * `AdvancedBloomFilter`/`DropShadowFilter` recipe as the effects bar's
   * frames — "مؤشر ذهبي متسق مع الهوية الملكية". Focus fires the instant a
   * finger touches the pill (`pointerdown`, not the later `pointertap`) so
   * the OS keyboard opens with no extra delay waiting for release; a drag
   * instead (or in addition — focusing does not cancel it) pans the text to
   * review earlier content (see handleInputPointerMove()).
   * `hitArea`/`bg` are sized in layoutComposer() once the pill's width is
   * known; everything here is built root-centered on local (0, 0), same
   * convention as every other control in this file.
   */
  private buildInputField(): InputFieldObj {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'text';

    const bg = new Graphics();
    root.addChild(bg);

    const placeholder = new Text({
      text: PLACEHOLDER_TEXT,
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: INPUT_FONT_SIZE, fontWeight: '700', fill: PLACEHOLDER_COLOR }),
    });
    placeholder.anchor.set(0.5);
    placeholder.alpha = PLACEHOLDER_ALPHA;
    root.addChild(placeholder);

    // Never added to the display tree — a Pixi mask doesn't need to be, it
    // only needs to be assigned to `scrollGroup.mask` below. Drawn to its
    // real size once the pill's width is known, in layoutComposer().
    const mask = new Graphics();

    // Bottom-right anchored (see `text.anchor` below): both axes grow
    // *away* from a fixed corner as more is typed — right-to-left for a
    // line's own characters (RTL), upward for additional lines — clipped by
    // `mask`, panned via refreshInputVisual()'s inputScrollX/Y once content
    // outgrows the pill's one-line-tall window.
    const scrollGroup = new Container();
    scrollGroup.mask = mask;
    root.addChild(scrollGroup);

    const text = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: INPUT_FONT_SIZE,
        fontWeight: '700',
        fill: INPUT_TEXT_COLOR,
        lineHeight: INPUT_LINE_HEIGHT,
      }),
    });
    // (1, 1): anchored at the block's own bottom-right corner. For a single
    // line this reproduces the old vertically-centered look (see
    // refreshInputVisual()'s INPUT_TEXT_BOTTOM_PAD offset); for multiple
    // lines the block simply grows *upward* past the window from that fixed
    // corner, so the most-recently-typed line always sits at the bottom —
    // the exact same "auto-follow via a fixed anchor + a stationary mask"
    // trick the X axis already used before multi-line existed, now doing
    // the same job on Y for free, with no separate scroll math needed for
    // the default (non-dragged) case.
    text.anchor.set(1, 1);
    text.filters = [this.inputGlow];
    scrollGroup.addChild(text);

    const cursor = new Graphics().rect(-CURSOR_WIDTH / 2, -CURSOR_HEIGHT / 2, CURSOR_WIDTH, CURSOR_HEIGHT).fill(EFFECT_GOLD);
    cursor.filters = effectFrameFilters();
    cursor.visible = false;
    scrollGroup.addChild(cursor);

    root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      // The browser's own default mousedown/pointerdown action runs *after*
      // this listener and blurs whatever is currently focused whenever the
      // down-target isn't itself a focusable element — true here, since the
      // down-target is the shared `<canvas>`. Left alone, that default
      // action fires immediately after `.focus()` below and silently steals
      // focus straight back to `<body>` in the very same event. This is
      // exactly what the browser's own default is for — never call it
      // without a concrete reason — and this is one: suppress it so the
      // focus below actually sticks.
      event.preventDefault();
      this.inputDragPointerId = event.pointerId;
      this.inputDragStartX = event.global.x;
      this.inputDragStartY = event.global.y;
      this.inputDragStartScrollX = this.inputScrollX;
      this.inputDragStartScrollY = this.inputScrollY;
      // Fires immediately on touch-down, not on release — see this
      // method's own doc comment. A drag that follows doesn't cancel it;
      // reviewing text by panning while the OS keyboard stays open is the
      // same experience any native multi-line field gives.
      this.ghostInput.focus();

      // Pixel-accurate tap-to-position: map the touch straight to a
      // character index (see hitTestCaretIndex()) and hand it to the real
      // <textarea>'s own selection, so the next keystroke/backspace acts
      // from exactly where the player touched — not always from the end.
      // `scrollGroup.toLocal()` undoes every ancestor transform up to and
      // including scrollGroup's own current pan offset, landing exactly in
      // the same unpanned coordinate space `text`/`cursor` are positioned
      // in below, so it needs no manual adjustment for the current scroll.
      const local = this.inputField.scrollGroup.toLocal(event.global);
      const hitIndex = this.hitTestCaretIndex(local.x, local.y);
      this.ghostInput.setSelectionRange(hitIndex, hitIndex);
      this.refreshInputVisual();
    });
    root.on('pointertap', (event: FederatedPointerEvent) => {
      // Focus already happened on pointerdown above — this only still
      // exists to stop the tap from bubbling to app.stage's tap-to-fire
      // rocket listener underneath.
      event.stopPropagation();
    });

    return { root, bg, scrollGroup, mask, text, placeholder, cursor };
  }

  /**
   * Touch-panning for the input field — "التحكم بالإصبع" alongside the
   * auto-scroll refreshInputVisual() already does on both axes while
   * typing. Registered once, globally, same pattern as wireControlBox()'s
   * own stage-level pointermove/pointerup pair; both gate themselves on
   * their own piece of state so they never interfere with each other.
   */
  private handleInputPointerMove = (event: FederatedPointerEvent): void => {
    if (this.inputDragPointerId === null || event.pointerId !== this.inputDragPointerId) return;
    const deltaX = event.global.x - this.inputDragStartX;
    const deltaY = event.global.y - this.inputDragStartY;
    this.inputScrollX = this.clampInputScrollX(this.inputDragStartScrollX + deltaX);
    // Dragging the finger down (positive deltaY) reveals earlier lines —
    // the same direction a chat log or any bottom-anchored feed scrolls.
    this.inputScrollY = this.clampInputScrollY(this.inputDragStartScrollY + deltaY);
    this.applyInputScroll();
  };

  private handleInputPointerEnd = (event: FederatedPointerEvent): void => {
    if (this.inputDragPointerId === null || event.pointerId !== this.inputDragPointerId) return;
    this.inputDragPointerId = null;
  };

  /**
   * The one deliberate DOM element in this class — a real `<textarea>`
   * (not `<input>`: a single-line input silently drops the Enter key,
   * which is exactly the key that has to survive here to produce a real
   * `\n` in `this.text`), invisible (`opacity: 0`, `pointer-events: none`,
   * see createHiddenTextArea()) and never positioned over anything: Pixi's
   * own hit-testing on the input pill is what decides whether a tap
   * counts, and `.focus()` needs no visual placement to raise the OS
   * keyboard, so there is nothing to keep in sync on layout/resize.
   * Focusing it (buildInputField()'s `pointerdown` handler) raises the
   * device's own OS keyboard — autocorrect, predictive text, personal
   * dictionary, voice input, a real Return key, all free. Its `input`
   * event is the single bridge back into Pixi: `this.text =
   * ghostInput.value` feeds the exact same refreshInputVisual() pipeline
   * every other change to `this.text` already goes through, so the
   * scroll/mask built for it works identically regardless of where a
   * character (or a newline) came from.
   *
   * A prior revision of this class instead hand-drew every key of a full
   * Arabic keyboard in Pixi, trading every one of the OS features above
   * away for zero DOM. Both are legitimate, deliberate architectural
   * choices — this is the second one.
   */
  private buildGhostInput(): HTMLTextAreaElement {
    const input = createHiddenTextArea();
    input.addEventListener('input', () => {
      const oldText = this.text;
      const newText = input.value;
      if (this.composeMode === 'spark-eraser' && newText.length < oldText.length) this.triggerDeleteSpark(oldText, newText);
      this.text = newText;
      this.refreshInputVisual();
      this.previewText.text = this.text || SAMPLE_PHRASE;
    });
    input.addEventListener('focus', () => this.startCursorBlink());
    input.addEventListener('blur', () => this.stopCursorBlink());
    // Keeps the drawn caret in sync with the real textarea's own selection
    // for any move that isn't a tap or a keystroke (e.g. the OS keyboard's
    // arrow keys, or a native long-press-drag to reposition) — `input`
    // above only fires when the *text* changes, not when just the caret
    // does. `selectionchange` is a document-level event with no target
    // filter of its own, hence the activeElement check.
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === input) this.refreshInputVisual();
    });
    return input;
  }

  /**
   * Reverse of hitTestCaretIndex(): given an absolute character index into
   * `this.text` (as `ghostInput.selectionStart` reports it — a single
   * offset into the *whole* string, `\n`s included), finds which line it
   * falls on and its offset within just that line's own text.
   */
  private locateCaretPosition(lines: string[], caretIndex: number): { lineIndex: number; offsetInLine: number } {
    let consumed = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length;
      if (i === lines.length - 1 || caretIndex <= consumed + lineLength) {
        return { lineIndex: i, offsetInLine: clampNumber(caretIndex - consumed, 0, lineLength) };
      }
      consumed += lineLength + 1; // +1 for the '\n' itself
    }
    return { lineIndex: 0, offsetInLine: 0 };
  }

  /**
   * Real glyph-metric hit-testing, not a guess: maps a touch point (already
   * in scrollGroup's own unpanned local space, see buildInputField()'s
   * `pointerdown` handler) to the nearest character boundary. First picks
   * the tapped *line* from the vertical offset from the fixed bottom
   * anchor (see refreshInputVisual()'s own doc comment for why that anchor
   * position is constant regardless of line count), then walks that one
   * line's own prefix widths — via `CanvasTextMetrics`, the same technique
   * CharacterReveal.ts already uses for per-character positions — and
   * picks whichever boundary the tap actually landed closest to.
   */
  private hitTestCaretIndex(localX: number, localY: number): number {
    const lines = this.text.split('\n');
    const availWidth = Math.max(0, this.inputFieldWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    const bottomPad = (INPUT_HEIGHT - INPUT_FONT_SIZE) / 2;
    const anchorY = INPUT_HEIGHT / 2 - bottomPad;

    const rawLineFromBottom = Math.round((anchorY - localY) / INPUT_LINE_HEIGHT);
    const lineFromBottom = clampNumber(rawLineFromBottom, 0, lines.length - 1);
    const lineIndex = lines.length - 1 - lineFromBottom;
    const lineText = lines[lineIndex];

    let bestOffset = lineText.length;
    let bestDist = Infinity;
    for (let i = 0; i <= lineText.length; i++) {
      const prefix = lineText.slice(0, i);
      const prefixWidth = prefix.length ? CanvasTextMetrics.measureText(prefix, this.inputField.text.style).width : 0;
      const boundaryX = availWidth / 2 - prefixWidth;
      const dist = Math.abs(boundaryX - localX);
      if (dist < bestDist) {
        bestDist = dist;
        bestOffset = i;
      }
    }

    let consumed = 0;
    for (let i = 0; i < lineIndex; i++) consumed += lines[i].length + 1;
    return consumed + bestOffset;
  }

  /**
   * Repaints the field's live text/placeholder/caret from `this.text` —
   * called on every keystroke and every selection change from ghostInput
   * itself (see buildGhostInput()), on every tap (see buildInputField()'s
   * `pointerdown`, which also moves the real selection first), and once up
   * front so the field never starts blank when it should show a pre-filled
   * value (e.g. reopening the composer on previously-committed text). Runs
   * synchronously inline with whichever of those triggered it — no
   * deferral, so the redraw always lands in the very same frame as the
   * keystroke/tap that caused it.
   *
   * Text stays at its one true `INPUT_FONT_SIZE` always — never shrunk,
   * never wrapped to fit a fixed-size pill. What *does* grow now is line
   * count: pressing the OS keyboard's Return key inserts a real `\n` (see
   * buildGhostInput()), and `text.text` renders every line Pixi's own
   * canvas text engine always could — multi-line was never a rendering
   * gap, only a matter of this method's own math and the field's fixed
   * one-line-tall window (`INPUT_HEIGHT`, unchanged: the top bar's height
   * still doesn't cascade into the rest of the layout below it).
   *
   * `text.anchor` (see buildInputField()) is pinned to the block's own
   * bottom-right corner, so the *last* line's *own* trailing edge always
   * sits at that fixed corner with zero extra math — a line longer than
   * the pill grows leftward (RTL) past the corner, a second-or-later line
   * grows upward past it, both simply clipped by the stationary `mask`.
   * The caret, though, can now sit anywhere in the text (see
   * hitTestCaretIndex()) — `ghostInput.selectionStart` is the single
   * source of truth for where, read fresh every call — so the old
   * "always snap fully to one edge" auto-scroll is replaced by
   * `nudgeScrollToReveal()`: shift the view the *minimum* amount needed to
   * keep the caret in the visible window, in whichever direction it's
   * actually out of view, leaving it untouched if the caret (e.g. a spot
   * the player just tapped) was already visible. For a caret sitting at
   * the true end this still converges on exactly the old snap-to-edge
   * result — see the method's own doc comment.
   */
  private refreshInputVisual(): void {
    // Keeps ghostInput in sync even when this.text changed from a source
    // other than ghostInput's own `input` event (e.g. reopening the
    // composer pre-filled with previously-committed text) — comparing
    // first (rather than assigning unconditionally) matters here: setting
    // `.value` to a string that's already current would otherwise reset
    // the very selection a tap/selectionchange just established.
    if (this.ghostInput.value !== this.text) this.ghostInput.value = this.text;

    const hasText = this.text.length > 0;
    this.inputField.text.text = this.text;
    this.inputField.text.visible = hasText;
    this.inputField.placeholder.visible = !hasText;

    // Pop only on genuine additions (typing/pasting), never on deletion —
    // see triggerInputBounce()'s own doc comment on the constant it reads —
    // and only while 'spring' mode is active (see ComposeMode's own doc
    // comment: this used to be unconditional, now it's opt-in).
    if (
      this.composeMode === 'spring' &&
      this.text.length > this.previousInputTextForBounce.length &&
      this.text !== this.previousInputTextForBounce
    ) {
      this.inputBounceStart = this.deps.app.ticker.lastTime;
    }
    this.previousInputTextForBounce = this.text;
    // Recomputed every call since the text's own width changes with every
    // keystroke: with anchor (1, 1) the rendered texture spans local
    // x ∈ [-width, 0], y ∈ [-height, 0], so its visual center sits at
    // (-width/2, -height/2) — `origin`, not `pivot`, so re-centering it
    // here never nudges the text's own on-screen position (see
    // INPUT_BOUNCE_* constants' own doc comment on why `origin` specifically).
    this.inputField.text.origin.set(-this.inputField.text.width / 2, -this.inputField.text.height / 2);

    const availWidth = Math.max(0, this.inputFieldWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    // Reproduces the single-line field's old vertically-centered look
    // exactly (INPUT_HEIGHT=36, INPUT_FONT_SIZE=15 leaves 21px of slack —
    // this anchors the bottom line's own baseline area at the same y a
    // (1, 0.5)-anchored single line used to sit at) while still leaving
    // room above for earlier lines to scroll up into, unseen, behind
    // `mask`.
    const bottomPad = (INPUT_HEIGHT - INPUT_FONT_SIZE) / 2;
    const anchorY = INPUT_HEIGHT / 2 - bottomPad;
    this.inputField.text.position.set(availWidth / 2, anchorY);

    const lines = this.text.split('\n');
    const lineWidths = lines.map((line) => (line.length ? CanvasTextMetrics.measureText(line, this.inputField.text.style).width : 0));
    const widestLineWidth = Math.max(0, ...lineWidths);

    // Bounds on how far the player can pan by hand (see
    // handleInputPointerMove) — the *widest* line's own extent, not just
    // the last line's: an earlier line can easily be longer than
    // wherever the caret currently sits.
    this.inputMaxScrollX = hasText ? Math.max(0, widestLineWidth + CURSOR_GAP - availWidth) : 0;
    this.inputMaxScrollY = hasText ? Math.max(0, this.inputField.text.height - INPUT_HEIGHT + bottomPad) : 0;

    if (!hasText) {
      this.inputScrollX = 0;
      this.inputScrollY = 0;
      this.applyInputScroll();
      this.inputField.cursor.position.set(availWidth / 2 - CURSOR_GAP, anchorY - INPUT_LINE_HEIGHT / 2);
      return;
    }

    const caretIndex = clampNumber(this.ghostInput.selectionStart ?? this.text.length, 0, this.text.length);
    const { lineIndex, offsetInLine } = this.locateCaretPosition(lines, caretIndex);
    const prefixWidth = offsetInLine
      ? CanvasTextMetrics.measureText(lines[lineIndex].slice(0, offsetInLine), this.inputField.text.style).width
      : 0;
    const caretLocalX = availWidth / 2 - prefixWidth - CURSOR_GAP;
    const linesFromBottom = lines.length - 1 - lineIndex;
    const caretLocalY = anchorY - linesFromBottom * INPUT_LINE_HEIGHT - INPUT_LINE_HEIGHT / 2;

    this.inputScrollX = this.nudgeScrollToReveal(this.inputScrollX, caretLocalX, -availWidth / 2, availWidth / 2, this.inputMaxScrollX);
    this.inputScrollY = this.nudgeScrollToReveal(this.inputScrollY, caretLocalY, -INPUT_HEIGHT / 2, INPUT_HEIGHT / 2, this.inputMaxScrollY);
    this.applyInputScroll();

    this.inputField.cursor.position.set(caretLocalX, caretLocalY);
  }

  private clampInputScrollX(x: number): number {
    return clampNumber(x, 0, this.inputMaxScrollX);
  }

  private clampInputScrollY(y: number): number {
    return clampNumber(y, 0, this.inputMaxScrollY);
  }

  /**
   * Shifts `current` the minimum amount needed so that `pointLocal`
   * (already in the same unpanned local space `current` is applied
   * against — see applyInputScroll()) lands within `[windowMin,
   * windowMax]`; leaves it untouched if the point is already inside that
   * range. Shared by both axes in refreshInputVisual() — see that
   * method's own doc comment for why this replaces the old "always snap
   * to one edge" logic.
   */
  private nudgeScrollToReveal(current: number, pointLocal: number, windowMin: number, windowMax: number, max: number): number {
    const visible = pointLocal + current;
    let next = current;
    if (visible < windowMin) next += windowMin - visible;
    else if (visible > windowMax) next -= visible - windowMax;
    return clampNumber(next, 0, max);
  }

  private applyInputScroll(): void {
    this.inputField.scrollGroup.x = this.inputScrollX;
    this.inputField.scrollGroup.y = this.inputScrollY;
  }

  private startCursorBlink(): void {
    this.inputField.cursor.visible = true;
    this.cursorBlinkTimer?.cancel();
    this.cursorBlinkTimer = tickerSetInterval(this.deps.app.ticker, () => {
      this.inputField.cursor.visible = !this.inputField.cursor.visible;
    }, CURSOR_BLINK_MS);
  }

  private stopCursorBlink(): void {
    this.cursorBlinkTimer?.cancel();
    this.cursorBlinkTimer = undefined;
    this.inputField.cursor.visible = false;
  }

  /** Plain glass circle, same look as HeaderBar's own back/home buttons — see the BACK_* constants' doc comment for why this one stays outside the gold identity. */
  private buildBackButton(): { root: Container; bg: Graphics } {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-BACK_HIT_SIZE / 2, -BACK_HIT_SIZE / 2, BACK_HIT_SIZE, BACK_HIT_SIZE);

    const bg = new Graphics().circle(0, 0, BACK_DIAMETER / 2).fill({ color: BACK_BG_COLOR, alpha: BACK_BG_ALPHA });
    root.addChild(bg);

    const glyph = new Sprite();
    glyph.anchor.set(0.5);
    glyph.tint = BACK_ICON_TINT;
    glyph.width = BACK_ICON_SIZE;
    glyph.height = BACK_ICON_SIZE;
    root.addChild(glyph);
    void iconTexture('arrowBack', BACK_ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      glyph.texture = texture;
    });

    return { root, bg };
  }

  /** Recomputes every position from the current screen size — called once at construction and again on every resize, same pattern as PlanningIconColumn.layout(). */
  private layoutComposer(): void {
    const screen = this.deps.app.screen;
    const composerWidth = Math.min(COMPOSER_MAX_WIDTH, screen.width * COMPOSER_WIDTH_RATIO);
    const composerX = (screen.width - composerWidth) / 2;
    this.composerContainer.position.set(composerX, COMPOSER_TOP_Y);

    this.backButton.root.position.set(composerWidth - BACK_DIAMETER / 2, TOPBAR_HEIGHT / 2);

    const inputWidth = composerWidth - BACK_DIAMETER - GAP_BACK_INPUT;
    this.inputFieldWidth = inputWidth;
    this.inputField.root.position.set(inputWidth / 2, TOPBAR_HEIGHT / 2);
    this.inputField.root.hitArea = new Rectangle(-inputWidth / 2, -INPUT_HIT_HEIGHT / 2, inputWidth, INPUT_HIT_HEIGHT);
    this.inputField.bg
      .clear()
      .roundRect(-inputWidth / 2, -INPUT_HEIGHT / 2, inputWidth, INPUT_HEIGHT, 12)
      .fill({ color: 0xffffff, alpha: 0.08 });

    // A Pixi mask never added to the display tree is evaluated in *global*
    // space — so the clip rectangle has to be drawn at the pill's real
    // on-screen position, not root's local origin.
    const availWidth = Math.max(0, inputWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    const pillGlobal = this.inputField.root.getGlobalPosition();
    this.inputField.mask
      .clear()
      .rect(pillGlobal.x - availWidth / 2, pillGlobal.y - INPUT_HEIGHT / 2, availWidth, INPUT_HEIGHT)
      .fill(0xffffff);

    const contentBottom = this.layoutComposeModeRow(composerWidth, TOPBAR_HEIGHT + EFFECTS_MARGIN_TOP - MODE_ROW_MARGIN_TOP);
    this.catchAll.clear().rect(0, 0, composerWidth, contentBottom).fill({ color: 0x000000, alpha: 0.001 });

    // Re-applies the auto-scroll against the (possibly just-changed) input
    // width — a resize alone, with no new keystroke, can push already-typed
    // text's caret out of view on a narrower screen.
    this.refreshInputVisual();
  }

  /** The mode row (fuse/spark-eraser/spring/smoke-cloud — see ComposeMode's own doc comment), centered as one row directly under the input field (there's no more effects bar above it to sit below). `aboveRowBottom` is a synthetic offset — MODE_ROW_MARGIN_TOP below it lands the row exactly where the input's own bottom margin already sat. */
  private layoutComposeModeRow(composerWidth: number, aboveRowBottom: number): number {
    const rowTop = aboveRowBottom + MODE_ROW_MARGIN_TOP;
    const rowContentWidth = this.composeModeFrames.length * PREVIEW_W + (this.composeModeFrames.length - 1) * ITEM_GAP_X;
    let rightEdge = composerWidth / 2 + rowContentWidth / 2;

    for (const frame of this.composeModeFrames) {
      frame.root.position.set(rightEdge - PREVIEW_W / 2, rowTop + PREVIEW_H / 2);
      rightEdge -= PREVIEW_W + ITEM_GAP_X;
    }

    this.syncComposeModeFrames(this.deps.app.ticker);
    return rowTop + ITEM_HEIGHT;
  }
}

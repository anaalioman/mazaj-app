import { Application, Container, FillGradient, Graphics, Rectangle, Sprite, Text, TextStyle, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { AdvancedBloomFilter, DropShadowFilter, GlowFilter } from 'pixi-filters';
import { iconTexture } from './svgIconTexture';
import type { IconName } from './icons';
import type { AudioManager } from '../audio/AudioManager';
import { tickerSetTimeout } from '../utils/tickerTimers';

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
const PADDING_TOP = 76;
// Bumped from 24: a real, reproduced bug on short screens had the column's
// tail rows (glow, "لون المقذوفة") render past app.screen.height entirely —
// see layout()'s own doc comment for the actual fix. This margin is the
// bottom safe-area clearance off the screen edge (system nav bars etc.).
const PADDING_BOTTOM = 60;
const COLUMN_RIGHT_INSET = 56;
const ROW_HEIGHT = 38;
const ROW_GAP = 20;
const ROW_SPACING = ROW_HEIGHT + ROW_GAP;
const ICON_SIZE = 22;
const ICON_SOURCE_SIZE = 44;
/**
 * Minimum touch target on both axes (Android's own accessibility guideline
 * is 48dp; 44 matches what the rest of this codebase already standardized
 * on). Each row's real hitArea is computed from the icon+label's *actual*
 * rendered bounds (see `computeHitArea()`) — not a flat guess — then padded
 * out to at least this size so short labels ("قلب") still get a comfortable
 * target. Longer labels ("توليد عشوائي هجين") can and do exceed this on
 * their own; the computed hitArea grows with them instead of clipping them.
 */
const HIT_MIN_SIZE = 44;
/** Extra breathing room on every side beyond the tight content bounds, so a finger landing just past a glyph's edge still registers. */
const HIT_PADDING = 8;

const IDLE_ALPHA = 0.75;
/** The 14 icon glyphs' unified gold identity — the row labels stay the old CSS's plain white, only the icons themselves carry this. */
const ICON_GOLD = 0xfff6df;
const LABEL_TINT = 0xffffff;
const FLASH_COLOR = 0x06b6d4;
const FLASH_MS = 180;
const RECORD_COLOR = 0xff5a63;
const RECORD_PULSE_MS = 1000;

/**
 * The soft rounded "premium button" plate behind every icon — same golden-
 * metallic family already established for TextComposer's compose-mode row
 * (dark-navy-to-black idle, warming to gold when active), so this column
 * reads as the same visual language rather than a separately-invented look.
 */
/** Diameter (40) stays just inside HIT_MIN_SIZE (44) so the visible plate never pokes out past its own row's tappable hitArea. */
const BG_RADIUS = 20;
const BG_METALLIC_TOP = 0x201c14;
const BG_METALLIC_BOTTOM = 0x0a0906;
const BG_METALLIC_TOP_ACTIVE = 0x5a4620;
const BG_METALLIC_BOTTOM_ACTIVE = 0x1c1508;
/**
 * "تتنفس بنعومة" — a slow, continuous idle glow every row always carries
 * (never fully off), oscillating between these two bounds via a plain sine
 * wave driven by `ticker.lastTime` — the same technique syncPreviewGlow()
 * (TextComposer.ts) already uses for the committed text's own breathing
 * halo. `GLOW_ACTIVE_BOOST` is the sustained brighter floor for whichever
 * row is currently "active" (see setActive()); `GLOW_TAP_BOOST` is a
 * further transient spike on top of that, decaying back down over
 * BOUNCE_DURATION_MS via the same eased-decay technique TextComposer's mode
 * row already uses (easeOutBounce/bounceStart, mirrored below).
 */
const GLOW_BREATHE_MIN = 0.4;
const GLOW_BREATHE_MAX = 0.9;
const GLOW_BREATHE_SPEED = 0.0018;
const GLOW_ACTIVE_BOOST = 1.1;
const GLOW_TAP_BOOST = 2.4;
const BOUNCE_MIN_SCALE = 0.86;
const BOUNCE_DURATION_MS = 260;
/** Freshly-resolved icon textures fade in over this long instead of popping in abruptly — see buildRow()'s own iconTexture().then(). */
const ICON_FADE_IN_MS = 150;

/** Standard "ease out bounce" (easings.net) — a ball dropped and settling, three diminishing bounces, never overshooting past 1. `t` and the return value are both 0..1. Mirrors TextComposer.ts's own copy (kept file-local rather than shared, same reasoning as this file's other small pure-math helpers). */
function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** A fresh filter pair per icon (Pixi filters aren't safely shareable across multiple display objects) — real bloom (bright-pass + blur + additive composite, not a flat glow) plus a real drop shadow for depth, same techniques already used for the fireworks glow (FireworksSystem.ts) and the text control box's handles (TextComposer.ts). */
function iconFilters(): (AdvancedBloomFilter | DropShadowFilter)[] {
  return [
    new AdvancedBloomFilter({ threshold: 0.3, blur: 3, quality: 4, bloomScale: 1.2, brightness: 1.05 }),
    new DropShadowFilter({ color: 0x000000, alpha: 0.5, blur: 2, offset: { x: 0, y: 2 } }),
  ];
}

/**
 * Unions the icon's and label's real rendered footprints (both are direct,
 * unrotated, unscaled children of the row's own root — center-anchored icon,
 * top-anchored label — so plain position ± width/2 gives exact local bounds
 * without needing a full `getBounds()` matrix walk), pads it, then floors it
 * to `HIT_MIN_SIZE` on both axes. Computed once at row-build time — the
 * result stays valid forever since these are fixed local offsets; only the
 * row's own `root.position` (set by `layout()`) ever changes.
 */
function computeHitArea(icon: Sprite | Text, label: Text): Rectangle {
  const iconHalfW = icon.width / 2;
  const iconHalfH = icon.height / 2;
  const labelHalfW = label.width / 2;

  let left = Math.min(icon.x - iconHalfW, label.x - labelHalfW) - HIT_PADDING;
  let right = Math.max(icon.x + iconHalfW, label.x + labelHalfW) + HIT_PADDING;
  let top = Math.min(icon.y - iconHalfH, label.y) - HIT_PADDING;
  let bottom = Math.max(icon.y + iconHalfH, label.y + label.height) + HIT_PADDING;

  if (right - left < HIT_MIN_SIZE) {
    const centerX = (left + right) / 2;
    left = centerX - HIT_MIN_SIZE / 2;
    right = centerX + HIT_MIN_SIZE / 2;
  }
  if (bottom - top < HIT_MIN_SIZE) {
    const centerY = (top + bottom) / 2;
    top = centerY - HIT_MIN_SIZE / 2;
    bottom = centerY + HIT_MIN_SIZE / 2;
  }

  return new Rectangle(left, top, right - left, bottom - top);
}

export interface IconRowSpec {
  id: string;
  /** 'T' draws the literal glyph (the old `.mzj-planning-text-icon` span) instead of a rasterized icon — the text-composer trigger has no line-icon artwork of its own. */
  icon: IconName | 'T';
  label: string;
  onTap: () => void;
  /** Opts out of the generic UI-click tick — for rows whose own onTap already plays a more specific sound (e.g. "لقطة"'s camera shutter) that a second, generic blip on top of would just muddy. */
  skipDefaultClickSound?: boolean;
}

interface Row {
  id: string;
  root: Container;
  /** The golden-metallic plate behind icon+label — see BG_* constants' own doc comment. Redrawn every frame (breathing glow + active/tap state), same pattern as TextComposer's compose-mode row. */
  bg: Graphics;
  /** Dedicated per-row GlowFilter driving the continuous idle breathing pulse plus the active/tap boosts — not shared, so each row's own animation phase/state stays independent. */
  glow: GlowFilter;
  icon: Sprite | Text;
  label: Text;
  active: boolean;
  recordGlow?: Graphics;
}

/**
 * The planning screen's right-hand icon column — 14 rows, each an
 * icon+label pair with a generous invisible hitArea, fully Pixi (no
 * DOM/CSS). Owns only the buttons themselves: what each tap *does*, and
 * which subpanel opens as a result, stays PlanningScreen's job via the
 * `onTap` callback each row is built with. `setActive`/`setRecording` let
 * the caller reflect state it owns (current mode, which subpanel is open,
 * recording in progress) back onto the right row's look.
 */
export class PlanningIconColumn {
  readonly container: Container;
  private readonly app: Application;
  private readonly audio: AudioManager;
  /** `ticker.lastTime` the current tap's bounce+glow-boost spike started at, or -1 once it's settled — same eased-decay pattern TextComposer's mode row uses. Keyed by row so only the tapped one spikes. */
  private bounceStart = -1;
  private bounceRow: Row | null = null;
  private readonly rows = new Map<string, Row>();

  constructor(app: Application, audio: AudioManager, specs: IconRowSpec[]) {
    this.app = app;
    this.audio = audio;
    this.container = new Container();
    app.stage.addChild(this.container);

    // The column's own hitArea (sized in layout()) absorbs taps landing in
    // the gaps between rows — no Graphics node, no draw calls, so unlike the
    // old catchAll this costs nothing at render time. Pixi hit-tests a
    // container's children before falling back to the container itself, so
    // a real row's own hitArea still wins first; only genuinely empty space
    // resolves to this container and stops here instead of reaching
    // app.stage's tap-to-fire listener.
    this.container.eventMode = 'static';
    this.container.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());

    for (const spec of specs) {
      this.rows.set(spec.id, this.buildRow(spec));
    }

    app.renderer.on('resize', () => this.layout());
    this.layout();
    app.ticker.add((ticker) => this.syncRowGlow(ticker));
  }

  /**
   * Per-frame visual sync for every row's golden-metallic plate — cheap even
   * mid-bounce: the eased spike only computes for `bounceRow`, every other
   * row just re-reads its own static idle/active breathing level. Runs for
   * all rows every frame (not just the bouncing one) since the idle breathe
   * itself is continuous, not triggered.
   */
  private syncRowGlow(ticker: Ticker): void {
    let spike = 0;
    if (this.bounceStart >= 0) {
      const t = Math.min(1, (ticker.lastTime - this.bounceStart) / BOUNCE_DURATION_MS);
      const eased = easeOutBounce(t);
      this.bounceRow?.root.scale.set(BOUNCE_MIN_SCALE + eased * (1 - BOUNCE_MIN_SCALE));
      spike = (1 - eased) * GLOW_TAP_BOOST;
      if (t >= 1) {
        this.bounceRow?.root.scale.set(1);
        this.bounceStart = -1;
        this.bounceRow = null;
        spike = 0;
      }
    }

    const breathe = GLOW_BREATHE_MIN + ((Math.sin(ticker.lastTime * GLOW_BREATHE_SPEED) + 1) / 2) * (GLOW_BREATHE_MAX - GLOW_BREATHE_MIN);
    for (const row of this.rows.values()) {
      const isBouncing = row === this.bounceRow;
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

  /** Toggles a row's "active" look (`color:#fff; font-weight:700` in the old CSS) — used for mode selection, subpanel-open state, and any other on/off trigger. */
  setActive(id: string, active: boolean): void {
    const row = this.rows.get(id);
    if (!row) return;
    row.active = active;
    row.label.style = this.labelStyle(active);
    row.icon.alpha = active ? 1 : IDLE_ALPHA;
  }

  /** Swaps its own icon/label text and grows a pulsing red glow (the old `@keyframes mzj-rec-pulse`) instead of the generic active/idle look. Always built with a Sprite icon (never the 'T' glyph), so the cast is safe. */
  setRecording(isRecording: boolean): void {
    const row = this.rows.get('mzj-planning-record');
    if (!row || !row.recordGlow) return;
    const sprite = row.icon as Sprite;
    void iconTexture(isRecording ? 'squareStop' : 'recordDot', ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      sprite.texture = texture;
    });
    row.label.text = isRecording ? 'إيقاف التسجيل' : 'تسجيل فيديو';
    row.recordGlow.visible = isRecording;
  }

  /** Marks a row unavailable (the old `button.disabled`) — used when recording isn't supported in this browser. */
  setDisabled(id: string, disabled: boolean): void {
    const row = this.rows.get(id);
    if (!row) return;
    row.root.eventMode = disabled ? 'none' : 'static';
    row.root.alpha = disabled ? 0.4 : 1;
  }

  private buildRow(spec: IconRowSpec): Row {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    this.container.addChild(root);

    const iconCenterY = -(ROW_HEIGHT - ICON_SIZE) / 2 - 2;

    // The golden-metallic plate — added first so it renders behind
    // everything else in this row (recordGlow/icon/label), redrawn every
    // frame by syncRowGlow() for the continuous breathing pulse.
    const glow = new GlowFilter({ distance: 8, outerStrength: GLOW_BREATHE_MIN, innerStrength: 0, color: ICON_GOLD, quality: 0.3 });
    const bg = new Graphics();
    bg.filters = [glow];
    bg.position.set(0, iconCenterY);
    root.addChild(bg);

    let iconDisplay: Sprite | Text;
    let recordGlow: Graphics | undefined;
    if (spec.id === 'mzj-planning-record') {
      // Behind the icon: a soft red halo (same layered-alpha additive
      // technique as the text control box's handle glow), hidden until
      // recording starts, pulsing via the ticker instead of a CSS
      // keyframe animation.
      recordGlow = new Graphics();
      const steps = 5;
      const radius = ICON_SIZE * 1.3;
      for (let i = steps; i > 0; i--) {
        const t = i / steps;
        recordGlow.circle(0, 0, radius * t).fill({ color: RECORD_COLOR, alpha: (1 - t) * 0.5 });
      }
      recordGlow.blendMode = 'add';
      recordGlow.visible = false;
      recordGlow.position.set(0, -(ROW_HEIGHT - ICON_SIZE) / 2 - ICON_SIZE / 2 + 2);
      root.addChild(recordGlow);
      this.app.ticker.add(() => {
        if (!recordGlow || !recordGlow.visible) return;
        const phase = (Math.sin((performance.now() / RECORD_PULSE_MS) * Math.PI * 2) + 1) / 2;
        recordGlow.alpha = 0.5 + phase * 0.5;
      });
    }

    if (spec.icon === 'T') {
      const glyph = new Text({
        text: 'T',
        style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: 18, fontWeight: '800', fill: ICON_GOLD }),
      });
      glyph.anchor.set(0.5);
      glyph.alpha = IDLE_ALPHA;
      glyph.filters = iconFilters();
      root.addChild(glyph);
      iconDisplay = glyph;
    } else {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.tint = ICON_GOLD;
      sprite.width = ICON_SIZE;
      sprite.height = ICON_SIZE;
      sprite.filters = iconFilters();
      // Starts invisible and fades in once its own texture actually resolves
      // — see ICON_FADE_IN_MS's own doc comment — rather than popping in
      // abruptly the instant iconTexture()'s promise settles.
      sprite.alpha = 0;
      root.addChild(sprite);
      let fadeElapsed = 0;
      const fadeIn = (ticker: Ticker): void => {
        fadeElapsed += ticker.deltaMS;
        sprite.alpha = Math.min(1, fadeElapsed / ICON_FADE_IN_MS) * IDLE_ALPHA;
        if (fadeElapsed >= ICON_FADE_IN_MS) this.app.ticker.remove(fadeIn);
      };
      void iconTexture(spec.icon, ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
        sprite.texture = texture;
        this.app.ticker.add(fadeIn);
      });
      iconDisplay = sprite;
    }
    iconDisplay.position.set(0, iconCenterY);

    const label = new Text({ text: spec.label, style: this.labelStyle(false) });
    label.anchor.set(0.5, 0);
    label.position.set(0, ICON_SIZE / 2 + 2);
    root.addChild(label);

    // Real hitArea from the icon+label's actual rendered footprint — not a
    // flat guess. Union both, in root's own local space (both are direct,
    // unrotated/unscaled children of root, so their own position + width/
    // height already give exact bounds without needing getBounds()'s full
    // matrix math), pad it, then floor it to a minimum touch target. Built
    // from `iconDisplay`/`label` specifically rather than `root.getLocalBounds()`
    // so the record row's decorative pulse halo (much wider than the icon
    // itself) never inflates its own tappable area relative to every other row.
    root.hitArea = computeHitArea(iconDisplay, label);

    const row: Row = { id: spec.id, root, bg, glow, icon: iconDisplay, label, active: false, recordGlow };

    root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (!spec.skipDefaultClickSound) this.audio.playUiClick();
      this.flash(root);
      this.bounceStart = this.app.ticker.lastTime;
      this.bounceRow = row;
      spec.onTap();
    });

    // Position is assigned by layout(), which runs once synchronously right after every row exists.
    return row;
  }

  private labelStyle(active: boolean): TextStyle {
    return new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize: 10,
      fontWeight: active ? '700' : '400',
      fill: LABEL_TINT,
    });
  }

  private flash(target: Container): void {
    // Tactile feedback (the old `.mzj-flash` cyan glow) drawn the same way
    // as the record pulse: a temporary additive halo, not a CSS box-shadow.
    const halo = new Graphics();
    const steps = 5;
    const radius = 26;
    for (let i = steps; i > 0; i--) {
      const t = i / steps;
      halo.circle(0, 0, radius * t).fill({ color: FLASH_COLOR, alpha: (1 - t) * 0.55 });
    }
    halo.blendMode = 'add';
    target.addChildAt(halo, 0);
    tickerSetTimeout(this.app.ticker, () => {
      halo.destroy();
    }, FLASH_MS);
  }

  /**
   * Where ColorPickerPanel/ShapesPanel (see SideDockPanel's `getLeftBoundary`
   * dep) should dock beside — the visual left extent of the whole column,
   * i.e. its fixed center minus whichever row currently renders widest
   * (icon or label), computed live rather than assumed, since it changes
   * with locale/label text.
   */
  getLeftEdgeX(): number {
    let maxHalfWidth = 0;
    for (const row of this.rows.values()) {
      maxHalfWidth = Math.max(maxHalfWidth, row.icon.width / 2, row.label.width / 2);
    }
    return this.app.screen.width - COLUMN_RIGHT_INSET - maxHalfWidth;
  }

  private layout(): void {
    const ids = Array.from(this.rows.keys());
    const rowCount = ids.length;
    const naturalContentHeight = (rowCount - 1) * ROW_SPACING + ROW_HEIGHT;
    const availableHeight = this.app.screen.height - PADDING_TOP - PADDING_BOTTOM;

    // Real, reproduced bug on short screens: centering used to clamp its
    // offset to zero once the column's natural height didn't fit, but never
    // actually shrank anything — so the tail rows (glow, then "لون
    // المقذوفة", the very last row) rendered past app.screen.height
    // entirely, sunk below the visible screen and completely unreachable.
    // Compress the *gap* between rows first — each row's own icon/label/
    // hitArea size never changes, so the 44px minimum touch target
    // (HIT_MIN_SIZE) is never at risk — down to zero gap if needed. Only
    // past that point (an extremely short viewport) does spacing hit its
    // floor at ROW_HEIGHT itself, which still keeps every row's *center*
    // within the safe area even if adjacent rows start to visually overlap
    // — a graceful-degradation tradeoff, not a row silently disappearing.
    const rowSpacing =
      naturalContentHeight <= availableHeight
        ? ROW_SPACING
        : Math.max(ROW_HEIGHT, (availableHeight - ROW_HEIGHT) / Math.max(rowCount - 1, 1));
    const contentHeight = (rowCount - 1) * rowSpacing + ROW_HEIGHT;
    const firstRowCenterY = PADDING_TOP + Math.max(0, (availableHeight - contentHeight) / 2) + ROW_HEIGHT / 2;
    const centerX = this.app.screen.width - COLUMN_RIGHT_INSET;

    ids.forEach((id, index) => {
      const row = this.rows.get(id)!;
      row.root.position.set(centerX, firstRowCenterY + index * rowSpacing);
    });

    // The column's own hitArea only needs to be at least as wide/tall as the
    // widest row's own real hitArea (see computeHitArea()) so no row's
    // content ever pokes out past it — computed from the rows' actual
    // hitAreas, not a repeated flat guess. Purely a hit-testing rectangle
    // (see the constructor's own doc comment); never drawn or rendered.
    let maxHalfWidth = HIT_MIN_SIZE / 2;
    let maxHalfHeight = HIT_MIN_SIZE / 2;
    for (const row of this.rows.values()) {
      const area = row.root.hitArea as Rectangle;
      maxHalfWidth = Math.max(maxHalfWidth, -area.left, area.right);
      maxHalfHeight = Math.max(maxHalfHeight, -area.top, area.bottom);
    }

    const lastRowCenterY = firstRowCenterY + (ids.length - 1) * rowSpacing;
    this.container.hitArea = new Rectangle(
      centerX - maxHalfWidth,
      firstRowCenterY - maxHalfHeight,
      maxHalfWidth * 2,
      lastRowCenterY - firstRowCenterY + maxHalfHeight * 2,
    );
  }
}

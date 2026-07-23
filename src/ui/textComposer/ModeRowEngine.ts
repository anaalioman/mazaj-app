import { CanvasTextMetrics, Container, FillGradient, Graphics, ParticleContainer, Rectangle, Sprite, Text, TextStyle, type Application, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { atlasTexture, iconTexture } from '../svgIconTexture';
import type { IconName } from '../icons';
import type { AudioManager } from '../../audio/AudioManager';
import { Particle, type ParticleOptions } from '../../fireworks/Particle';
import { getParticleTexture } from '../../fireworks/textures';
import { fastCosByIndex, fastSin, fastSinByIndex, TABLE_SIZE, TWO_PI } from '../../fireworks/SineTable';
import { InputFieldView, locateCaretPosition } from './InputFieldView';
import {
  COMPOSE_MODE_ENTRIES,
  CURSOR_GAP,
  CURSOR_WIDTH,
  DELETE_SPARK_COLORS,
  DELETE_SPARK_COUNT_MAX,
  DELETE_SPARK_COUNT_MIN,
  DELETE_SPARK_LIFE_MAX,
  DELETE_SPARK_LIFE_MIN,
  DELETE_SPARK_SIZE_MAX,
  DELETE_SPARK_SIZE_MIN,
  EFFECT_GOLD,
  FRAME_BORDER_ACTIVE_ALPHA,
  FRAME_BORDER_IDLE_ALPHA,
  FRAME_HIT_HEIGHT,
  FRAME_HIT_TOP,
  FRAME_HIT_WIDTH,
  FUSE_EMBER_COLOR,
  FUSE_EMBER_GLOW,
  FUSE_EMBER_RADIUS,
  FUSE_EMBER_SPAWN_INTERVAL_MS,
  FUSE_EMBER_SPEED,
  FUSE_ROPE_COLOR,
  FUSE_ROPE_GAP_BELOW_TEXT,
  FUSE_ROPE_WIDTH,
  GLOW_DISTANCE,
  GLOW_QUALITY,
  INPUT_BOUNCE_DURATION_MS,
  INPUT_BOUNCE_MIN_SCALE,
  INPUT_FONT_SIZE,
  INPUT_GLOW_BASE,
  INPUT_GLOW_BOOST,
  INPUT_HEIGHT,
  INPUT_LINE_HEIGHT,
  ITEM_GAP_X,
  ITEM_HEIGHT,
  LABEL_ACTIVE_COLOR,
  LABEL_FONT_SIZE,
  LABEL_GAP,
  LABEL_IDLE_ALPHA,
  LABEL_IDLE_COLOR,
  MODE_BOUNCE_DURATION_MS,
  MODE_BOUNCE_MIN_SCALE,
  MODE_GLOW_ACTIVE,
  MODE_GLOW_BASE,
  MODE_GLOW_TAP_BOOST,
  MODE_ICON_SIZE,
  MODE_ICON_SIZE_SOURCE,
  MODE_METALLIC_BOTTOM,
  MODE_METALLIC_BOTTOM_ACTIVE,
  MODE_METALLIC_TOP,
  MODE_METALLIC_TOP_ACTIVE,
  MODE_ROW_MARGIN_TOP,
  PREVIEW_H,
  PREVIEW_RADIUS,
  PREVIEW_W,
  TOPBAR_HEIGHT,
  diffChangedRange,
  easeOutBounce,
  type ComposeMode,
  type ComposeModeFrameObj,
  type RowMode,
} from './types';

// Static noise table, built once at module load — same convention as every
// fireworks pattern file (see fireworks/patterns/*.ts). Sized 512: a single
// triggerDeleteSpark() call's worst case (1 count draw + DELETE_SPARK_COUNT_MAX
// particles x 5 draws each = 1 + 15*5 = 76) stays comfortably under that, so
// no two draws within the same spark burst ever read the same slot. Walked
// via each ModeRowEngine instance's own advancing cursor (see nextRand()),
// not a shared module-level one — same per-instance convention as
// FireworksSystem's own randCursor.
const RANDOM_TABLE_SIZE = 512;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// Shared, reused slot for every fuse-ember/delete-spark spawn — Particle.init()
// (see its own doc comment) copies every field synchronously the instant
// it's called, so the same mutated object is safe to reuse across both spawn
// paths and every loop iteration instead of a fresh literal per spark.
const SPARK_SLOT: ParticleOptions = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: true };

/** Standard "ease out bounce" curve, mirrored via types.ts's own easeOutBounce — used identically here for both the mode row's tap spike and the input field's insert-pop. */

/**
 * Owns everything about the composer's second row of icons (fuse/spark-
 * eraser/spring/smoke-cloud — see ComposeMode/RowMode's own doc comments in
 * types.ts) plus the two ticker-driven effects those modes gate: the lit
 * fuse rope with its traveling ember, and the delete-spark particle burst.
 * Also drives the input field's own insert-pop (see triggerInputBounce()) —
 * a *tap*-triggered animation like the mode row's own bounce, not something
 * InputFieldView needs to know the trigger condition for.
 *
 * `composeMode`/`smokeCloudActive` are the composer's one true state for
 * "which behavior is currently active" — TextComposer reads them (via
 * `isSpringActive()`/`isSparkEraserActive()`) to gate InputFieldView's own
 * pop and GhostInputBridge's own delete-spark call, and reads
 * `smokeCloudActive` directly when committing (see resetForNextCommit()'s
 * own doc comment).
 */
export class ModeRowEngine {
  private readonly app: Application;
  private readonly audio: AudioManager;
  private readonly inputView: InputFieldView;
  private readonly inputGlow: GlowFilter;
  /** Reads the composer's current text on demand — this class never caches it, since `syncFuseEffect()` needs whatever's true *this* frame regardless of which ticker callback order registered first. */
  private readonly getText: () => string;
  /** Same parent fuseRope/fuseEmber are added to in the constructor — kept as a direct reference for toGlobal() rather than reading `.parent` back off a child every frame. */
  private readonly composerContainer: Container;

  composeMode: ComposeMode = 'none';
  smokeCloudActive = false;

  readonly frames: ComposeModeFrameObj[];
  private modeBounceStart = -1;
  private modeBounceFrame: ComposeModeFrameObj | null = null;

  /** Pre-baked flat white bar (`textComposerFuseBar`, see scripts/generateIconAtlas.mjs), tinted FUSE_ROPE_COLOR — stretched via `width` only every frame in syncFuseEffect(); no Graphics redraw. */
  private readonly fuseRope: Sprite;
  private readonly fuseEmber: Graphics;
  private readonly fuseEmberGlow: GlowFilter;
  private fuseEmberSpawnAccumulator = 0;
  /** Radians in `[0, TWO_PI)` for the ember's slide between the rope's two ends — incrementally advanced/wrapped once per frame in `syncFuseEffect()`, never re-derived from `ticker.lastTime` (which only ever grows) via a live `Math.sin()`. */
  private emberPhase = 0;
  /** Persistent walking cursor into the static `randomTable` — see `nextRand()`. */
  private rIdx: number;

  private readonly sparkTrailsContainer: ParticleContainer;
  private readonly sparkCoresContainer: ParticleContainer;
  private sparkParticles: Particle[] = [];
  private readonly sparkDeadPool: Particle[] = [];

  /** `ticker.lastTime` the input field's current pop started at, or -1 once settled — see INPUT_BOUNCE_* constants' own doc comment (types.ts). */
  private inputBounceStart = -1;

  constructor(
    app: Application,
    audio: AudioManager,
    composerContainer: Container,
    worldContainer: Container,
    inputView: InputFieldView,
    inputGlow: GlowFilter,
    getText: () => string,
  ) {
    this.app = app;
    this.audio = audio;
    this.inputView = inputView;
    this.inputGlow = inputGlow;
    this.getText = getText;
    this.composerContainer = composerContainer;
    // Seeded from the engine's own clock instead of Math.random() — see
    // `randCursor`'s own doc comment on FireworksSystem, the same convention.
    this.rIdx = (app.ticker.lastTime | 0) & RANDOM_MASK;

    this.frames = COMPOSE_MODE_ENTRIES.map((entry) => this.buildComposeModeFrame(entry.mode, entry.icon, entry.label, entry.stackable));
    for (const frame of this.frames) composerContainer.addChild(frame.root);
    this.wireComposeModeButtons();

    this.fuseRope = new Sprite(atlasTexture('textComposerFuseBar'));
    this.fuseRope.anchor.set(0.5);
    this.fuseRope.tint = FUSE_ROPE_COLOR;
    this.fuseRope.height = FUSE_ROPE_WIDTH;
    this.fuseRope.visible = false;
    composerContainer.addChild(this.fuseRope);
    this.fuseEmberGlow = new GlowFilter({ distance: GLOW_DISTANCE, outerStrength: FUSE_EMBER_GLOW, innerStrength: 0.4, color: FUSE_EMBER_COLOR, quality: GLOW_QUALITY });
    this.fuseEmber = new Graphics().circle(0, 0, FUSE_EMBER_RADIUS).fill(FUSE_EMBER_COLOR);
    this.fuseEmber.filters = [this.fuseEmberGlow];
    this.fuseEmber.visible = false;
    composerContainer.addChild(this.fuseEmber);

    const sparkTexture = getParticleTexture();
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
    // Deliberately parented under `worldContainer`, not `composerContainer`
    // (uiContainer's own child) — confirmed live that a `ParticleContainer`
    // doesn't work inside a cached render group; see this project's own
    // FireworksSystem constructor doc comment for the same fix applied for
    // the same reason. Sparks are purely transient composing-time feedback
    // (dead within under a second), and the composer and the snapshot-
    // capable immersive viewing mode are mutually exclusive, so living in
    // `worldContainer` never risks one leaking into a captured snapshot.
    worldContainer.addChild(this.sparkTrailsContainer, this.sparkCoresContainer);

    app.ticker.add((ticker) => this.syncComposeModeFrames(ticker));
    app.ticker.add((ticker) => this.syncFuseEffect(ticker));
    app.ticker.add((ticker) => this.syncDeleteSparks(ticker));
    app.ticker.add((ticker) => this.syncInputBounce(ticker));
  }

  /** Walks `randomTable` one step — see `rIdx`'s own doc comment. */
  private nextRand(): number {
    this.rIdx = (this.rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[this.rIdx];
  }

  isSpringActive(): boolean {
    return this.composeMode === 'spring';
  }

  isSparkEraserActive(): boolean {
    return this.composeMode === 'spark-eraser';
  }

  /** Starts the input field's own insert-pop — called from TextComposer whenever InputFieldView.refresh() reports the text just grew while 'spring' mode is active. */
  triggerInputBounce(): void {
    this.inputBounceStart = this.app.ticker.lastTime;
  }

  /**
   * Once a mode has actually been used (a commit *is* that use), it has no
   * business still showing "selected" the next time the composer opens for
   * a new word — called from TextComposer's confirmAndOpenControlBox().
   * Returns the smoke-cloud choice as it was *before* the reset, since that
   * snapshot (not the reset value) is what the caller needs to carry
   * forward into `consumeForReveal()`'s own `TextRevealConfig` — see that
   * method's own doc comment on why the effect only ever plays once the
   * real show starts, never on this still-idle control-box preview.
   */
  resetForNextCommit(): boolean {
    const smokeCloudChoice = this.smokeCloudActive;
    this.composeMode = 'none';
    this.smokeCloudActive = false;
    this.syncComposeModeFrames(this.app.ticker);
    return smokeCloudChoice;
  }

  /**
   * Fired from GhostInputBridge's `input` listener *before* `this.text` is
   * reassigned to `newText` — so the input field's own current layout still
   * reflects `oldText`, which is exactly what's needed: the deleted
   * character's on-screen position only exists in the *old* layout, not the
   * new (shorter) one. `diffChangedRange(newText, oldText)` (arguments
   * swapped from the "what got inserted" call) finds the `[start, end)`
   * slice of `oldText` that vanished; `start` is used as the caret index to
   * locate (a multi-character deletion, e.g. selecting a run and pressing
   * Backspace, still gets one burst at the run's own start — the same spot
   * the caret lands at afterward).
   */
  triggerDeleteSpark(oldText: string, newText: string): void {
    const { start } = diffChangedRange(newText, oldText);
    const lines = oldText.split('\n');
    const { lineIndex, offsetInLine } = locateCaretPosition(lines, start);
    const lineText = lines[lineIndex];
    const prefixWidth = offsetInLine ? CanvasTextMetrics.measureText(lineText.slice(0, offsetInLine), this.inputView.textStyle).width : 0;

    // Same math as InputFieldView's own caretLocalX/Y in refresh() —
    // reproduced here rather than shared since that method reads the
    // *current* text (already reassigned to `newText` by the time it next
    // runs) while this one deliberately measures `oldText`'s layout instead.
    const availWidth = Math.max(0, this.inputView.getFieldWidth() - CURSOR_WIDTH - CURSOR_GAP * 2);
    const bottomPad = (INPUT_HEIGHT - INPUT_FONT_SIZE) / 2;
    const anchorY = INPUT_HEIGHT / 2 - bottomPad;
    const localX = availWidth / 2 - prefixWidth - CURSOR_GAP;
    const linesFromBottom = lines.length - 1 - lineIndex;
    const localY = anchorY - linesFromBottom * INPUT_LINE_HEIGHT - INPUT_LINE_HEIGHT / 2;

    const global = this.inputView.scrollGroup.toGlobal({ x: localX, y: localY });
    this.spawnDeleteSparks(global.x, global.y);
  }

  /**
   * Per-frame visual sync for the mode row — cheap even when nothing is
   * mid-bounce: the eased spike only computes for `modeBounceFrame`, every
   * other frame just re-reads its own static idle/active glow level.
   * `MODE_METALLIC_*ACTIVE` swaps the whole gradient (not just the stroke,
   * unlike PlanningIconColumn's plate) — this row's own "غامق ذهبي إلى
   * مشع" identity — and the border stroke color itself follows the *live*
   * glow strength (lerped between the same two stops) so the metal itself,
   * not just the halo around it, visibly warms up during the tap spike.
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

    for (const frame of this.frames) {
      const active = frame.stackable ? this.smokeCloudActive : frame.mode === this.composeMode;
      const isBouncing = frame === this.modeBounceFrame;
      frame.glow.outerStrength = (active ? MODE_GLOW_ACTIVE : MODE_GLOW_BASE) + (isBouncing ? spike : 0);

      if (frame.drawnActive === active) continue;
      frame.drawnActive = active;

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
   * centered icon glyph and its own dedicated GlowFilter.
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

    return { mode, stackable, root, border, glyph, glow, label, drawnActive: null };
  }

  /**
   * Unlike the back arrow (whose tap always commits and closes the
   * composer), tapping a mode icon toggles it and keeps composing — tapping
   * the already-active one deselects it back to `'none'`, tapping a
   * different one switches directly. `stackable` (currently just
   * `'smoke-cloud'`) flips its own independent boolean instead of touching
   * `composeMode` at all, so it can be on at the same time as any of the
   * other three. Every tap, active-going or not, still fires the
   * micro-bounce/glow spike on *that* frame — physical feedback that the
   * press registered, whether it turned the mode on or off.
   */
  private wireComposeModeButtons(): void {
    for (const frame of this.frames) {
      frame.root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
      frame.root.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        this.audio.playUiClick();
        if (frame.stackable) {
          this.smokeCloudActive = !this.smokeCloudActive;
        } else {
          this.composeMode = this.composeMode === frame.mode ? 'none' : (frame.mode as ComposeMode);
        }
        this.modeBounceStart = this.app.ticker.lastTime;
        this.modeBounceFrame = frame;
        this.syncComposeModeFrames(this.app.ticker);
      });
    }
  }

  /**
   * Redraws the fuse rope + slides its ember every frame while
   * `composeMode === 'fuse'` and there's text to run it under; hidden (and
   * cheaply skipped) otherwise. The rope spans the *visible* text block's
   * own on-screen extent — measured the same way InputFieldView's own
   * refresh() already sizes the scroll window, so the rope never runs wider
   * than what the player can actually see (multi-line text keeps it pinned
   * under just the *last* line, which is always the one at the fixed bottom
   * anchor). The ember rides a `fastSin` oscillation between the rope's own
   * two ends, driven by `emberPhase` (incrementally advanced/wrapped every
   * frame, never a live `Math.sin()` re-derived from `ticker.lastTime`) and
   * periodically peels off a single real ember via this class's own
   * delete-spark particle pool.
   */
  private syncFuseEffect(ticker: Ticker): void {
    const text = this.getText();
    const active = this.composeMode === 'fuse' && text.length > 0;
    this.fuseRope.visible = active;
    this.fuseEmber.visible = active;
    if (!active) return;

    const availWidth = Math.max(0, this.inputView.getFieldWidth() - CURSOR_WIDTH - CURSOR_GAP * 2);
    const lines = text.split('\n');
    const lastLine = lines[lines.length - 1];
    const lastLineWidth = lastLine.length ? CanvasTextMetrics.measureText(lastLine, this.inputView.textStyle).width : 0;
    const ropeWidth = Math.min(availWidth, lastLineWidth);

    // Runs directly under the *visible glyphs*, not the pill's own center —
    // the text is right-anchored, so its right edge always sits at local
    // x = availWidth / 2 within the input field's own root. The fuse rope is
    // composerContainer's own child (a sibling of that root, not its
    // child), so that local x needs the input field root's own position
    // added back in to land in composerContainer's space.
    const textRightEdgeX = this.inputView.root.position.x + availWidth / 2;
    const ropeCenterX = textRightEdgeX - ropeWidth / 2;
    const ropeHalfWidth = ropeWidth / 2;

    // Anchored to the pill's own fixed bottom edge (TOPBAR_HEIGHT), not the
    // caret's own line — multi-line text's *last* line always sits at the
    // same fixed bottom anchor regardless of line count, so the rope's own
    // Y never needs to track it.
    const ropeY = TOPBAR_HEIGHT + FUSE_ROPE_GAP_BELOW_TEXT;

    // Pure Sprite stretch — no Graphics geometry rebuild. `height` stays
    // fixed (set once at construction); only `width`/`position` change here.
    this.fuseRope.position.set(ropeCenterX, ropeY);
    this.fuseRope.width = Math.max(1, ropeWidth);

    this.emberPhase += ticker.deltaMS * FUSE_EMBER_SPEED;
    if (this.emberPhase >= TWO_PI) this.emberPhase -= TWO_PI;
    const emberT = 0.5 + 0.5 * fastSin(this.emberPhase);
    const emberX = ropeCenterX - ropeHalfWidth + emberT * (ropeHalfWidth * 2);
    this.fuseEmber.position.set(emberX, ropeY);

    this.fuseEmberSpawnAccumulator += ticker.deltaMS;
    if (this.fuseEmberSpawnAccumulator >= FUSE_EMBER_SPAWN_INTERVAL_MS) {
      this.fuseEmberSpawnAccumulator = 0;
      // fuseEmber's own parent is composerContainer, same space ropeY/emberX are already in — see this method's own doc comment above.
      const global = this.composerContainer.toGlobal({ x: emberX, y: ropeY });
      this.spawnFuseEmber(global.x, global.y);
    }
  }

  /** A single, gentle ember (not a burst — see spawnDeleteSparks() for that) peeling off the traveling fuse point. Same pool as the delete-spark system. */
  private spawnFuseEmber(x: number, y: number): void {
    const particle = this.getPooledSparkParticle();
    SPARK_SLOT.x = x;
    SPARK_SLOT.y = y;
    SPARK_SLOT.vx = (this.nextRand() - 0.5) * 0.4;
    SPARK_SLOT.vy = -0.6 - this.nextRand() * 0.4;
    SPARK_SLOT.color = FUSE_EMBER_COLOR;
    SPARK_SLOT.size = 2 + this.nextRand();
    SPARK_SLOT.life = 20 + this.nextRand() * 14;
    SPARK_SLOT.gravity = 0.06;
    SPARK_SLOT.drag = 0.97;
    SPARK_SLOT.twinkle = true;
    particle.init(SPARK_SLOT);
    this.sparkParticles.push(particle);
  }

  /** One dead-pooled Particle (or a fresh one on a genuine pool miss) — mirrors FireworksSystem.spawnParticle()'s own pop-or-construct pattern. */
  private getPooledSparkParticle(): Particle {
    return this.sparkDeadPool.pop() ?? new Particle(getParticleTexture(), this.sparkTrailsContainer, this.sparkCoresContainer);
  }

  /** Radial burst of 10-15 embers at a global (x, y). */
  private spawnDeleteSparks(x: number, y: number): void {
    const count = DELETE_SPARK_COUNT_MIN + ((this.nextRand() * (DELETE_SPARK_COUNT_MAX - DELETE_SPARK_COUNT_MIN + 1)) | 0);
    for (let i = 0; i < count; i++) {
      const particle = this.getPooledSparkParticle();
      const angleIndex = (this.nextRand() * TABLE_SIZE) | 0;
      const speed = 1.2 + this.nextRand() * 2.4;

      SPARK_SLOT.x = x;
      SPARK_SLOT.y = y;
      SPARK_SLOT.vx = fastCosByIndex(angleIndex) * speed;
      SPARK_SLOT.vy = fastSinByIndex(angleIndex) * speed - 1; // slight upward kick so gravity's own pull down reads clearly
      SPARK_SLOT.color = DELETE_SPARK_COLORS[(this.nextRand() * DELETE_SPARK_COLORS.length) | 0];
      SPARK_SLOT.size = DELETE_SPARK_SIZE_MIN + this.nextRand() * (DELETE_SPARK_SIZE_MAX - DELETE_SPARK_SIZE_MIN);
      SPARK_SLOT.life = DELETE_SPARK_LIFE_MIN + this.nextRand() * (DELETE_SPARK_LIFE_MAX - DELETE_SPARK_LIFE_MIN);
      SPARK_SLOT.gravity = 0.12; // matches this codebase's own established burst-particle gravity range (see fireworks/patterns/*.ts)
      SPARK_SLOT.drag = 0.97;
      SPARK_SLOT.twinkle = true;
      particle.init(SPARK_SLOT);
      this.sparkParticles.push(particle);
    }
  }

  /** Ages/culls every live delete-spark — swap-with-last removal instead of `.filter()` (no new array per frame), same technique FireworksSystem.update() itself uses for its own particle pool. Gated on an empty array so an idle composer costs nothing per frame. */
  private syncDeleteSparks(ticker: Ticker): void {
    if (this.sparkParticles.length === 0) return;
    let i = 0;
    while (i < this.sparkParticles.length) {
      const particle = this.sparkParticles[i];
      const alive = particle.update(ticker.deltaTime);
      if (!alive) {
        particle.kill();
        this.sparkDeadPool.push(particle);
        const last = this.sparkParticles.pop();
        if (i < this.sparkParticles.length && last) {
          this.sparkParticles[i] = last;
        }
      } else {
        i++;
      }
    }
  }

  /**
   * Drives the input field's pop — a no-op whenever `inputBounceStart` is
   * idle (-1, the common case) so it costs nothing while the player isn't
   * actively typing. `eased` feeds *both* the text's own scale and
   * `inputGlow.outerStrength` from the exact same value every frame (see
   * INPUT_BOUNCE_/INPUT_GLOW_ constants' own doc comment in types.ts for why
   * that locks them together rather than merely starting together). The
   * instant the bounce finishes (t >= 1), the glow is explicitly snapped
   * back to its own resting level rather than left at its boosted peak —
   * plain assignment, not eased, since easeOutBounce(1) is exactly 1 and
   * would otherwise leave outerStrength permanently boosted once idle.
   */
  private syncInputBounce(ticker: Ticker): void {
    if (this.inputBounceStart < 0) return;
    const elapsed = ticker.lastTime - this.inputBounceStart;
    const t = Math.min(1, elapsed / INPUT_BOUNCE_DURATION_MS);
    if (t >= 1) {
      this.inputView.setPopScale(1);
      this.inputGlow.outerStrength = INPUT_GLOW_BASE;
      this.inputBounceStart = -1;
      return;
    }
    const eased = easeOutBounce(t);
    this.inputView.setPopScale(INPUT_BOUNCE_MIN_SCALE + eased * (1 - INPUT_BOUNCE_MIN_SCALE));
    this.inputGlow.outerStrength = INPUT_GLOW_BASE + eased * INPUT_GLOW_BOOST;
  }

  /** The mode row (fuse/spark-eraser/spring/smoke-cloud), centered as one row directly under the input field. `aboveRowBottom` is a synthetic offset — MODE_ROW_MARGIN_TOP below it lands the row exactly where the input's own bottom margin already sat. Returns the row's own bottom edge, for the caller's catchAll sizing. */
  layoutRow(composerWidth: number, aboveRowBottom: number): number {
    const rowTop = aboveRowBottom + MODE_ROW_MARGIN_TOP;
    const rowContentWidth = this.frames.length * PREVIEW_W + (this.frames.length - 1) * ITEM_GAP_X;
    let rightEdge = composerWidth / 2 + rowContentWidth / 2;

    for (const frame of this.frames) {
      frame.root.position.set(rightEdge - PREVIEW_W / 2, rowTop + PREVIEW_H / 2);
      rightEdge -= PREVIEW_W + ITEM_GAP_X;
    }

    this.syncComposeModeFrames(this.app.ticker);
    return rowTop + ITEM_HEIGHT;
  }
}

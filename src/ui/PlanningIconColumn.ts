import { Application, Container, Graphics, Rectangle, Sprite, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import { iconTexture } from './svgIconTexture';
import type { IconName } from './icons';

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
const PADDING_BOTTOM = 24;
const COLUMN_RIGHT_INSET = 56;
const ROW_HEIGHT = 38;
const ROW_GAP = 20;
const ROW_SPACING = ROW_HEIGHT + ROW_GAP;
const ICON_SIZE = 22;
const ICON_SOURCE_SIZE = 44;
/** Same reasoning as every other control converted so far — a real Pixi hitArea per finger, independent of the visible icon/label's own footprint. */
const HIT_WIDTH = 64;
const HIT_HEIGHT = 44;

const IDLE_ALPHA = 0.75;
const ACTIVE_TINT = 0xffffff;
const IDLE_TINT = 0xffffff;
const FLASH_COLOR = 0x06b6d4;
const FLASH_MS = 180;
const RECORD_COLOR = 0xff5a63;
const RECORD_PULSE_MS = 1000;

export interface IconRowSpec {
  id: string;
  /** 'T' draws the literal glyph (the old `.mzj-planning-text-icon` span) instead of a rasterized icon — the text-composer trigger has no line-icon artwork of its own. */
  icon: IconName | 'T';
  label: string;
  onTap: () => void;
}

interface Row {
  id: string;
  root: Container;
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
  private readonly rows = new Map<string, Row>();

  constructor(app: Application, specs: IconRowSpec[]) {
    this.app = app;
    this.container = new Container();
    app.stage.addChild(this.container);

    for (const spec of specs) {
      this.rows.set(spec.id, this.buildRow(spec));
    }

    app.renderer.on('resize', () => this.layout());
    this.layout();
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
    root.hitArea = new Rectangle(-HIT_WIDTH / 2, -HIT_HEIGHT / 2, HIT_WIDTH, HIT_HEIGHT);
    this.container.addChild(root);

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
        style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: 18, fontWeight: '800', fill: IDLE_TINT }),
      });
      glyph.anchor.set(0.5);
      glyph.alpha = IDLE_ALPHA;
      root.addChild(glyph);
      iconDisplay = glyph;
    } else {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.tint = IDLE_TINT;
      sprite.alpha = IDLE_ALPHA;
      sprite.width = ICON_SIZE;
      sprite.height = ICON_SIZE;
      root.addChild(sprite);
      void iconTexture(spec.icon, ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
        sprite.texture = texture;
      });
      iconDisplay = sprite;
    }
    iconDisplay.position.set(0, -(ROW_HEIGHT - ICON_SIZE) / 2 - 2);

    const label = new Text({ text: spec.label, style: this.labelStyle(false) });
    label.anchor.set(0.5, 0);
    label.position.set(0, ICON_SIZE / 2 + 2);
    root.addChild(label);

    root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.flash(root);
      spec.onTap();
    });

    // Position is assigned by layout(), which runs once synchronously right after every row exists.
    return { id: spec.id, root, icon: iconDisplay, label, active: false, recordGlow };
  }

  private labelStyle(active: boolean): TextStyle {
    return new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize: 10,
      fontWeight: active ? '700' : '400',
      fill: active ? ACTIVE_TINT : IDLE_TINT,
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
    window.setTimeout(() => {
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
    const contentHeight = (ids.length - 1) * ROW_SPACING + ROW_HEIGHT;
    const availableHeight = this.app.screen.height - PADDING_TOP - PADDING_BOTTOM;
    const firstRowCenterY = PADDING_TOP + Math.max(0, (availableHeight - contentHeight) / 2) + ROW_HEIGHT / 2;
    const centerX = this.app.screen.width - COLUMN_RIGHT_INSET;

    ids.forEach((id, index) => {
      const row = this.rows.get(id)!;
      row.root.position.set(centerX, firstRowCenterY + index * ROW_SPACING);
    });
  }
}

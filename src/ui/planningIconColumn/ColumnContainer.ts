import { Application, Container, Sprite, type FederatedPointerEvent } from 'pixi.js';
import type { AudioManager } from '../../audio/AudioManager';
import { iconTexture } from '../svgIconTexture';
import { ICON_SOURCE_SIZE, IDLE_ALPHA, type IconRowSpec, type Row } from './types';
import { buildRow, labelStyle } from './RowComponent';
import { createBounceState, flashTap, syncRowGlow, triggerBounce } from './AnimationEngine';
import { getColumnLeftEdgeX, layoutColumn } from './LayoutManager';

/**
 * The planning screen's right-hand icon column — 14 rows, each an
 * icon+label pair with a generous invisible hitArea, fully Pixi (no
 * DOM/CSS). Owns only the buttons themselves: what each tap *does*, and
 * which subpanel opens as a result, stays PlanningScreen's job via the
 * `onTap` callback each row is built with. `setActive`/`setRecording` let
 * the caller reflect state it owns (current mode, which subpanel is open,
 * recording in progress) back onto the right row's look.
 *
 * The column's own container carries a gap-absorbing hitArea (sized by
 * LayoutManager's layoutColumn()) plus `eventMode = 'static'`: a tap
 * landing in the gap between rows resolves to this container and stops
 * there instead of reaching app.stage's tap-to-fire listener. No Graphics
 * node, no draw calls — a hitArea is a pure hit-testing rectangle, never
 * rendered, so this costs nothing at render time. Pixi hit-tests a
 * container's children before falling back to the container itself, so a
 * real row's own hitArea (see RowComponent) still wins whenever a tap
 * actually lands on it.
 */
export class PlanningIconColumn {
  readonly container: Container;
  private readonly app: Application;
  private readonly audio: AudioManager;
  private readonly bounce = createBounceState();
  private readonly rows = new Map<string, Row>();

  constructor(app: Application, audio: AudioManager, specs: IconRowSpec[]) {
    this.app = app;
    this.audio = audio;
    this.container = new Container();
    app.stage.addChild(this.container);

    this.container.eventMode = 'static';
    this.container.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());

    for (const spec of specs) {
      const row = buildRow(app, this.container, spec, (tappedRow, tappedSpec) => this.handleRowTap(tappedRow, tappedSpec));
      this.rows.set(spec.id, row);
    }

    app.renderer.on('resize', () => this.layout());
    this.layout();
    app.ticker.add((ticker) => syncRowGlow(this.rows, this.bounce, ticker));
  }

  /** Click sound + tactile flash + bounce/glow spike + the row's own action — the bookkeeping every row's `pointertap` triggers, centralized here since it's the one place that owns the shared bounce state across all rows. */
  private handleRowTap(row: Row, spec: IconRowSpec): void {
    if (!spec.skipDefaultClickSound) this.audio.playUiClick();
    flashTap(row.root, this.app.ticker);
    triggerBounce(this.bounce, this.app.ticker, row);
    spec.onTap();
  }

  /** Toggles a row's "active" look (`color:#fff; font-weight:700` in the old CSS) — used for mode selection, subpanel-open state, and any other on/off trigger. */
  setActive(id: string, active: boolean): void {
    const row = this.rows.get(id);
    if (!row) return;
    row.active = active;
    row.label.style = labelStyle(active);
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

  /** Where ColorPickerPanel/ShapesPanel should dock beside — see LayoutManager's getColumnLeftEdgeX(). */
  getLeftEdgeX(): number {
    return getColumnLeftEdgeX(this.app, this.rows);
  }

  private layout(): void {
    layoutColumn(this.app, this.rows, this.container);
  }
}

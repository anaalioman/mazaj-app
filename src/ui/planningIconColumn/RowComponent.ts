import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Application, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { AdvancedBloomFilter, DropShadowFilter, GlowFilter } from 'pixi-filters';
import { iconTexture } from '../svgIconTexture';
import {
  GLOW_BREATHE_MIN,
  HIT_MIN_SIZE,
  HIT_PADDING,
  ICON_FADE_IN_MS,
  ICON_GOLD,
  ICON_SIZE,
  ICON_SOURCE_SIZE,
  IDLE_ALPHA,
  LABEL_TINT,
  RECORD_COLOR,
  RECORD_PULSE_MS,
  ROW_HEIGHT,
  type IconRowSpec,
  type Row,
} from './types';

/**
 * Unions the icon's and label's real rendered footprints (both are direct,
 * unrotated, unscaled children of the row's own root — center-anchored icon,
 * top-anchored label — so plain position ± width/2 gives exact local bounds
 * without needing a full `getBounds()` matrix walk), pads it, then floors it
 * to `HIT_MIN_SIZE` on both axes. Computed once at row-build time — the
 * result stays valid forever since these are fixed local offsets; only the
 * row's own `root.position` (set by LayoutManager) ever changes.
 */
export function computeHitArea(icon: Sprite | Text, label: Text): Rectangle {
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

/** A fresh filter pair per icon (Pixi filters aren't safely shareable across multiple display objects) — real bloom (bright-pass + blur + additive composite, not a flat glow) plus a real drop shadow for depth, same techniques already used for the fireworks glow (FireworksSystem.ts) and the text control box's handles (TextComposer.ts). */
function iconFilters(): (AdvancedBloomFilter | DropShadowFilter)[] {
  return [
    new AdvancedBloomFilter({ threshold: 0.3, blur: 3, quality: 4, bloomScale: 1.2, brightness: 1.05 }),
    new DropShadowFilter({ color: 0x000000, alpha: 0.5, blur: 2, offset: { x: 0, y: 2 } }),
  ];
}

/** The row label's TextStyle for a given active state — exported so ColumnContainer's setActive() can re-apply it without duplicating the font spec. */
export function labelStyle(active: boolean): TextStyle {
  return new TextStyle({
    fontFamily: 'Tajawal, system-ui, sans-serif',
    fontSize: 10,
    fontWeight: active ? '700' : '400',
    fill: LABEL_TINT,
  });
}

/**
 * Builds one row's full visual tree (golden-metallic plate, icon/glyph,
 * label) and its computed hitArea, wires its own tap handling, and returns
 * the resulting Row record for ColumnContainer to store and animate.
 * `onTap` is called with the row and its spec on `pointertap` — the actual
 * click-sound/flash/bounce bookkeeping lives in ColumnContainer since it
 * owns the shared bounce state across all rows.
 */
export function buildRow(
  app: Application,
  parent: Container,
  spec: IconRowSpec,
  onTap: (row: Row, spec: IconRowSpec) => void,
): Row {
  const root = new Container();
  root.eventMode = 'static';
  root.cursor = 'pointer';
  parent.addChild(root);

  const iconCenterY = -(ROW_HEIGHT - ICON_SIZE) / 2 - 2;

  // The golden-metallic plate — added first so it renders behind
  // everything else in this row (recordGlow/icon/label), redrawn every
  // frame by AnimationEngine's syncRowGlow() for the continuous breathing
  // pulse.
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
    app.ticker.add(() => {
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
      if (fadeElapsed >= ICON_FADE_IN_MS) app.ticker.remove(fadeIn);
    };
    void iconTexture(spec.icon, ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      sprite.texture = texture;
      app.ticker.add(fadeIn);
    });
    iconDisplay = sprite;
  }
  iconDisplay.position.set(0, iconCenterY);

  const label = new Text({ text: spec.label, style: labelStyle(false) });
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
    onTap(row, spec);
  });

  // Position is assigned by LayoutManager's layoutColumn(), which runs once synchronously right after every row exists.
  return row;
}

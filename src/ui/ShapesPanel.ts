import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import type { BurstType } from '../fireworks/FireworksSystem';
import { iconTexture } from './svgIconTexture';
import type { IconName } from './icons';
import { SideDockPanel } from './SideDockPanel';

const PANEL_WIDTH = 108;
const ROW_HEIGHT = 54;
const ICON_SIZE = 26;

interface ShapeEntry {
  id: string;
  icon: IconName;
  label: string;
  burstType?: BurstType;
  isGroundFountain?: boolean;
  isMortarToggle?: boolean;
}

const SHAPES: ShapeEntry[] = [
  { id: 'peony', icon: 'peony', label: 'بيوني بقلب', burstType: 'peony' },
  { id: 'rose', icon: 'rose', label: 'وردة', burstType: 'rose' },
  { id: 'kamuro', icon: 'kamuro', label: 'كامورو ذهبي', burstType: 'kamuro' },
  { id: 'groundFountain', icon: 'groundFountain', label: 'نافورة أرضية', isGroundFountain: true },
  { id: 'crossette', icon: 'crossette', label: 'كروسيت نخلة', burstType: 'crossette' },
  { id: 'multiRing', icon: 'multiRing', label: 'حلقات متعددة', burstType: 'multiRing' },
  { id: 'strobe', icon: 'strobe', label: 'وميض متلألئ', burstType: 'strobe' },
  { id: 'heart', icon: 'heart', label: 'قلب', burstType: 'heart' },
  // Targeting mode, not a shape — but the player's own reasoning for putting
  // it here holds: this whole panel is already "where does a shape launch
  // from" (see sequential pin placement), and مدفع/حر decides that same
  // thing for every entry above it, so it belongs in the same plan.
  { id: 'mortar', icon: 'rocket', label: 'مدفع', isMortarToggle: true },
];

interface Row {
  id: string;
  ring: Graphics;
}

/**
 * "الأشكال": a fully canvas-drawn (no HTML/CSS) panel — see SideDockPanel
 * for the shared dock/slide/bloom/title mechanics — listing the original 7
 * shape/pattern icons (rasterized from the exact same SVG artwork `icon()`
 * uses elsewhere, see svgIconTexture.ts), plus "مدفع" (the tap-targeting
 * mode toggle, moved in from the header — it decides where every shape
 * above it actually launches from, so it lives in the same plan), all in
 * one vertical column beside the right icon column, matching
 * ColorPickerPanel's style exactly. Tapping a shape fires the same callback
 * wireShapeToggles() used to call directly; tapping "نافورة أرضية" or
 * "مدفع" fires their own mode toggles. Either way the panel auto-closes
 * immediately — a confirmed pick, not a hover.
 */
export class ShapesPanel extends SideDockPanel {
  private readonly onPickShape: (type: BurstType) => void;
  private readonly onToggleGroundFountain: () => void;
  private readonly onToggleMortar: () => void;
  private readonly rows: Row[] = [];
  private activeIds = new Set<string>();

  constructor(
    app: Application,
    getLeftBoundary: () => number,
    onOpenChange: ((open: boolean) => void) | undefined,
    onPickShape: (type: BurstType) => void,
    onToggleGroundFountain: () => void,
    onToggleMortar: () => void,
  ) {
    super(app, 'حدد الشكل', PANEL_WIDTH, getLeftBoundary, onOpenChange);
    this.onPickShape = onPickShape;
    this.onToggleGroundFountain = onToggleGroundFountain;
    this.onToggleMortar = onToggleMortar;

    let y = this.contentTop + ROW_HEIGHT / 2;
    for (const entry of SHAPES) {
      const row = this.buildRow(entry, y);
      this.rows.push(row);
      y += ROW_HEIGHT;
    }

    this.finalize(SHAPES.length * ROW_HEIGHT);
  }

  private buildRow(entry: ShapeEntry, y: number): Row {
    const group = new Container();
    group.position.set(this.panelWidth / 2, y);
    group.eventMode = 'static';
    group.cursor = 'pointer';

    const ring = new Graphics();
    ring.blendMode = 'add';
    group.addChild(ring);

    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    sprite.tint = 0xffe9b3;
    sprite.width = ICON_SIZE;
    sprite.height = ICON_SIZE;
    sprite.position.set(0, -8);
    group.addChild(sprite);
    void iconTexture(entry.icon, 48, '#ffffff').then((texture) => {
      sprite.texture = texture;
    });

    const label = new Text({
      text: entry.label,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: 9,
        fontWeight: '700',
        fill: 0xffffff,
        align: 'center',
      }),
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, 10);
    group.addChild(label);

    const hitArea = new Graphics()
      .rect(-this.panelWidth / 2 + 4, -ROW_HEIGHT / 2 + 2, this.panelWidth - 8, ROW_HEIGHT - 4)
      .fill({ color: 0xffffff, alpha: 0.001 });
    group.addChild(hitArea);

    // `pointerdown` must be stopped independently of `pointertap` — see
    // SideDockPanel's own doc comment for why (raw `pointerdown` bubbles to
    // `app.stage`'s rocket-fire listener before `pointertap` even fires).
    group.on('pointerdown', (event) => event.stopPropagation());
    group.on('pointertap', (event) => {
      event.stopPropagation();
      this.pick(entry);
    });

    this.addContent(group);
    return { id: entry.id, ring };
  }

  private pick(entry: ShapeEntry): void {
    if (entry.isGroundFountain) this.onToggleGroundFountain();
    else if (entry.isMortarToggle) this.onToggleMortar();
    else if (entry.burstType) this.onPickShape(entry.burstType);
    // A confirmed pick — collapse back to a clean planning view immediately.
    this.setOpen(false);
  }

  /**
   * The caller (PlanningScreen) owns which shapes actually count as "active"
   * — it depends on launch mode (mass allows several at once; sequential
   * only one) plus the independent ground-fountain toggle — so it recomputes
   * that set itself and pushes it in here after every change, rather than
   * this panel tracking selection state on its own like ColorPickerPanel can
   * (color only ever has one active choice).
   */
  setActive(ids: ReadonlySet<string>): void {
    this.activeIds = new Set(ids);
    for (const row of this.rows) {
      row.ring.clear();
      if (this.activeIds.has(row.id)) {
        row.ring
          .roundRect(-this.panelWidth / 2 + 8, -ROW_HEIGHT / 2 + 4, this.panelWidth - 16, ROW_HEIGHT - 8, 10)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
      }
    }
  }
}

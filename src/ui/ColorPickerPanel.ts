import { Application, Container, Graphics, Rectangle, Sprite, Text, TextStyle } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { COLOR_CHOICES, type NamedColorChoice } from '../fireworks/colors';
import { getParticleTexture } from '../fireworks/textures';
import type { FireworksSystem } from '../fireworks/FireworksSystem';

const SWATCH_RADIUS = 13;
const SWATCH_GAP = 10;
const PANEL_PADDING = 16;
// Wider than the swatch column itself needs — the title wraps across a
// couple of lines within this width instead of overflowing sideways past
// the panel (it's docked at the screen's right edge, so an unwrapped line
// would run straight off the viewport).
const PANEL_WIDTH = 108;
const TITLE_AREA = 56;
const PANEL_TOP = 100;
const HALO_SCALE = 2.6;
const SLIDE_MS = 220;
const MULTI_SEGMENT_COLORS = [0xff2d2d, 0xfff23d, 0x39ff6a, 0x1e6bff, 0x9a3dff, 0xff2ecb];

interface Swatch {
  id: string;
  group: Container;
  ring: Graphics;
}

/**
 * "لون المقذوفة": a fully canvas-drawn (no HTML/CSS) vertical panel that
 * slides in from the screen's right edge. Every swatch is a real additive
 * glow — a color-tinted soft-particle-texture halo (the same shared texture
 * every spark in the engine uses) behind a solid `add`-blended core — plus a
 * shared AdvancedBloomFilter over the whole panel, the identical filter
 * FireworksSystem uses on its own bursts, so the swatches genuinely bloom
 * like neon instead of reading as flat color chips. Picking one calls
 * `FireworksSystem.setActiveColor()` immediately; every subsequent rocket is
 * dyed that color however it's launched (free tap, mass, or sequential).
 */
export class ColorPickerPanel {
  private readonly app: Application;
  private readonly fireworks: FireworksSystem;
  private readonly container: Container;
  private readonly panelBg: Graphics;
  private readonly title: Text;
  private readonly swatches: Swatch[] = [];
  private activeId = 'multi';

  private isOpen = false;
  private animT = 0;
  private animDir = 0;
  private panelWidth = 0;
  private panelHeight = 0;

  constructor(app: Application, fireworks: FireworksSystem) {
    this.app = app;
    this.fireworks = fireworks;

    this.container = new Container();
    this.container.visible = false;
    this.container.filters = [
      new AdvancedBloomFilter({ threshold: 0.35, blur: 4, quality: 4, bloomScale: 1.2, brightness: 1 }),
    ];
    app.stage.addChild(this.container);

    this.panelBg = new Graphics();
    this.panelBg.eventMode = 'static';
    // Absorbs every tap anywhere on the panel (gaps included) so it never
    // leaks through to the stage's own tap-to-fire handler underneath.
    this.panelBg.on('pointertap', (event) => event.stopPropagation());
    this.container.addChild(this.panelBg);

    this.title = new Text({
      text: 'حدد لون المقذوفة',
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontWeight: '800',
        fontSize: 12,
        fill: 0xffe9b3,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: PANEL_WIDTH - PANEL_PADDING * 2,
      }),
    });
    this.title.anchor.set(0.5, 0);
    this.container.addChild(this.title);

    for (const choice of COLOR_CHOICES) this.swatches.push(this.buildSwatch(choice));

    this.layout();
    app.renderer.on('resize', () => this.layout());
    app.ticker.add(this.tick);
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    this.animDir = open ? 1 : -1;
    if (open) this.container.visible = true;
  }

  private buildSwatch(choice: NamedColorChoice): Swatch {
    const group = new Container();
    group.eventMode = 'static';
    group.cursor = 'pointer';

    if (choice.hex === null) {
      // "متعدد الألوان": a small pinwheel of the palette's own hues instead of one flat tint.
      const segments = MULTI_SEGMENT_COLORS.length;
      const wheel = new Graphics();
      for (let i = 0; i < segments; i++) {
        const a0 = (Math.PI * 2 * i) / segments;
        const a1 = (Math.PI * 2 * (i + 1)) / segments;
        wheel.moveTo(0, 0).arc(0, 0, SWATCH_RADIUS, a0, a1).lineTo(0, 0).fill({ color: MULTI_SEGMENT_COLORS[i] });
      }
      wheel.blendMode = 'add';
      group.addChild(wheel);
    } else {
      const halo = new Sprite(getParticleTexture(this.app));
      halo.anchor.set(0.5);
      halo.tint = choice.hex;
      halo.blendMode = 'add';
      halo.width = SWATCH_RADIUS * 2 * HALO_SCALE;
      halo.height = SWATCH_RADIUS * 2 * HALO_SCALE;
      group.addChild(halo);

      const core = new Graphics().circle(0, 0, SWATCH_RADIUS).fill({ color: choice.hex });
      core.blendMode = 'add';
      group.addChild(core);
    }

    const ring = new Graphics();
    ring.blendMode = 'add';
    group.addChild(ring);

    const hitArea = new Graphics().circle(0, 0, SWATCH_RADIUS * 1.5).fill({ color: 0xffffff, alpha: 0.001 });
    group.addChild(hitArea);

    group.on('pointertap', (event) => {
      event.stopPropagation();
      this.select(choice.id);
    });

    this.container.addChild(group);
    return { id: choice.id, group, ring };
  }

  private select(id: string): void {
    if (this.activeId === id) return;
    const choice = COLOR_CHOICES.find((c) => c.id === id);
    if (!choice) return;
    this.activeId = id;
    this.fireworks.setActiveColor(choice.hex);
    this.syncActiveRing();
  }

  private syncActiveRing(): void {
    for (const swatch of this.swatches) {
      swatch.ring.clear();
      if (swatch.id === this.activeId) {
        swatch.ring.circle(0, 0, SWATCH_RADIUS + 4).stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
      }
    }
  }

  private layout(): void {
    const count = COLOR_CHOICES.length;
    this.panelWidth = PANEL_WIDTH;
    this.panelHeight = TITLE_AREA + count * (SWATCH_RADIUS * 2) + (count - 1) * SWATCH_GAP + PANEL_PADDING * 2;

    this.panelBg
      .clear()
      .roundRect(0, 0, this.panelWidth, this.panelHeight, 18)
      .fill({ color: 0x0a0a14, alpha: 0.6 })
      .stroke({ width: 1.5, color: 0xffe9b3, alpha: 0.35 });
    this.panelBg.hitArea = new Rectangle(0, 0, this.panelWidth, this.panelHeight);

    this.title.position.set(this.panelWidth / 2, PANEL_PADDING);

    let y = PANEL_PADDING + TITLE_AREA + SWATCH_RADIUS;
    for (const swatch of this.swatches) {
      swatch.group.position.set(this.panelWidth / 2, y);
      y += SWATCH_RADIUS * 2 + SWATCH_GAP;
    }
    this.syncActiveRing();

    this.container.y = PANEL_TOP;
    this.applyPosition();
  }

  private applyPosition(): void {
    const { width } = this.app.screen;
    this.container.x = width - this.panelWidth * this.animT;
    this.container.alpha = this.animT;
  }

  private tick = (ticker: { deltaMS: number }): void => {
    if (this.animDir === 0) return;
    this.animT += (ticker.deltaMS / SLIDE_MS) * this.animDir;
    this.animT = Math.max(0, Math.min(1, this.animT));
    this.applyPosition();
    if (this.animDir > 0 && this.animT >= 1) this.animDir = 0;
    if (this.animDir < 0 && this.animT <= 0) {
      this.animDir = 0;
      this.container.visible = false;
    }
  };
}

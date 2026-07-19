import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { COLOR_CHOICES, type NamedColorChoice } from '../fireworks/colors';
import { getParticleTexture } from '../fireworks/textures';
import type { FireworksSystem } from '../fireworks/FireworksSystem';
import { SideDockPanel } from './SideDockPanel';

const SWATCH_RADIUS = 13;
// A real gap against the app's own 44px minimum-touch-target standard
// (PlanningIconColumn.HIT_MIN_SIZE): SWATCH_RADIUS * 1.5 alone gives a
// 39px hitArea diameter, just under it.
const SWATCH_HIT_RADIUS = 22;
// Bumped from 10: with SWATCH_HIT_RADIUS raised to close the 44px gap
// above, the old gap would have made adjacent swatches' circular hitAreas
// overlap (2 * 22 = 44 > the old 26 + 10 = 36 vertical spacing) — whichever
// swatch happened to be on top in z-order would then swallow taps meant
// for its neighbor. 18 keeps them just touching, not overlapping.
const SWATCH_GAP = 18;
// Wider than the swatch column itself needs — the title wraps across a
// couple of lines within this width instead of overflowing sideways past
// the panel (it's docked at the screen's right edge, so an unwrapped line
// would run straight off the viewport).
const PANEL_WIDTH = 108;
const HALO_SCALE = 2.6;
const MULTI_SEGMENT_COLORS = [0xff2d2d, 0xfff23d, 0x39ff6a, 0x1e6bff, 0x9a3dff, 0xff2ecb];

interface Swatch {
  id: string;
  group: Container;
  ring: Graphics;
}

/**
 * "لون المقذوفة": a fully canvas-drawn (no HTML/CSS) glowing swatch grid —
 * see SideDockPanel for the shared dock/slide/bloom/title mechanics. Every
 * swatch is a real additive glow — a color-tinted soft-particle-texture
 * halo (the same shared texture every spark in the engine uses) behind an
 * `add`-blended solid core — so the swatches genuinely bloom like neon
 * instead of reading as flat color chips. Picking one calls
 * `FireworksSystem.setActiveColor()` immediately and auto-closes the panel;
 * every subsequent rocket is dyed that color however it's launched (free
 * tap, mass, or sequential).
 */
export class ColorPickerPanel extends SideDockPanel {
  private readonly fireworks: FireworksSystem;
  private readonly swatches: Swatch[] = [];
  private activeId = 'multi';

  constructor(
    app: Application,
    fireworks: FireworksSystem,
    getLeftBoundary: () => number,
    onOpenChange?: (open: boolean) => void,
  ) {
    super(app, 'حدد لون المقذوفة', PANEL_WIDTH, getLeftBoundary, onOpenChange);
    this.fireworks = fireworks;

    let y = this.contentTop + SWATCH_RADIUS;
    for (const choice of COLOR_CHOICES) {
      const swatch = this.buildSwatch(choice);
      swatch.group.position.set(this.panelWidth / 2, y);
      this.addContent(swatch.group);
      this.swatches.push(swatch);
      y += SWATCH_RADIUS * 2 + SWATCH_GAP;
    }
    this.syncActiveRing();

    const count = COLOR_CHOICES.length;
    this.finalize(count * (SWATCH_RADIUS * 2) + (count - 1) * SWATCH_GAP);
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
      const halo = new Sprite(getParticleTexture());
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

    const hitArea = new Graphics().circle(0, 0, SWATCH_HIT_RADIUS).fill({ color: 0xffffff, alpha: 0.001 });
    group.addChild(hitArea);

    // `pointerdown` must be stopped independently of `pointertap` — see
    // SideDockPanel's own doc comment for why (raw `pointerdown` bubbles to
    // `app.stage`'s rocket-fire listener before `pointertap` even fires).
    group.on('pointerdown', (event) => event.stopPropagation());
    group.on('pointertap', (event) => {
      event.stopPropagation();
      this.select(choice.id);
    });

    return { id: choice.id, group, ring };
  }

  private select(id: string): void {
    const choice = COLOR_CHOICES.find((c) => c.id === id);
    if (!choice) return;
    if (this.activeId !== id) {
      this.activeId = id;
      this.fireworks.setActiveColor(choice.hex);
      this.syncActiveRing();
    }
    // A confirmed pick — collapse back to a clean planning view immediately.
    this.setOpen(false);
  }

  private syncActiveRing(): void {
    for (const swatch of this.swatches) {
      swatch.ring.clear();
      if (swatch.id === this.activeId) {
        swatch.ring.circle(0, 0, SWATCH_RADIUS + 4).stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
      }
    }
  }
}

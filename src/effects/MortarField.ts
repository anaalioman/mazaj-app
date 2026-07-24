import { Application, Container, Graphics } from 'pixi.js';

const STATION_COUNT = 7;
const FLASH_FRAMES = 10;

interface Station {
  x: number;
  base: Graphics;
  flash: Graphics;
  flashTimer: number;
}

/**
 * Decorative mortar tubes anchored along the bottom edge. Purely cosmetic —
 * launches stay fully free-form (any tapped x/y), the nearest tube just
 * flashes and recoils so the scene reads as "fired from the ground" instead
 * of constraining where a shell can actually launch from.
 *
 * Hidden by default — the tubes only belong on screen while "مدفع" (Mortar
 * Mode) is actually selected (see setVisible(), driven by PlanningScreen's
 * own onInputModeChange in fireworksMood.ts); free-tap play keeps the bottom
 * edge completely clear of them, matching the mode's own name.
 */
export class MortarField {
  private readonly app: Application;
  readonly container: Container;
  private stations: Station[] = [];

  constructor(app: Application) {
    this.app = app;
    this.container = new Container();
    this.container.visible = false;
    app.stage.addChild(this.container);

    for (let i = 0; i < STATION_COUNT; i++) {
      const base = new Graphics();
      this.drawTube(base);

      const flash = new Graphics();
      this.drawFlash(flash);
      flash.visible = false;

      this.container.addChild(base, flash);
      this.stations.push({ x: 0, base, flash, flashTimer: 0 });
    }

    this.layout();
    app.renderer.on('resize', () => this.layout());
  }

  /**
   * Shows/hides every tube at once — see the class's own doc comment on why
   * this defaults to hidden. Turning it back on resets every station's own
   * flash/recoil state first: fireNear() keeps firing on every launch
   * regardless of visibility (harmless while hidden — update() itself no-ops
   * per station), so without this reset a tube could pop back into view
   * mid-flash from a launch that happened while free-tap mode was active.
   */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
    if (visible) {
      for (const station of this.stations) {
        station.flashTimer = 0;
        station.flash.visible = false;
        station.base.scale.y = 1;
      }
    }
  }

  /**
   * A tapered barrel on a tripod stand instead of the old flat rounded-rect
   * tube — wider at the base, narrowing toward the muzzle like a real mortar,
   * with a shaded half + a highlight strip faking a cylindrical light wrap
   * (Pixi's Graphics has no gradient fill), reinforcement bands, and a
   * metallic rim around a dark bore. Every shape is drawn with y=0 at the
   * ground and negative y going up — the same convention update()'s own
   * `base.scale.y` recoil relies on (scaling from that ground origin), so
   * the redesign has to keep it or the recoil dip breaks.
   */
  private drawTube(g: Graphics): void {
    // Soft contact shadow, grounding the tripod visually.
    g.ellipse(0, 1, 15, 4).fill({ color: 0x000000, alpha: 0.35 });

    // Tripod stand: two angled support legs + a low foot plate.
    g.poly([-16, 2, -5, -10, 5, -10, 16, 2]).fill({ color: 0x15161c });
    g.roundRect(-13, -2, 26, 5, 2).fill({ color: 0x0d0e12 });

    // Tapered barrel — wider at the base (±9px) narrowing to the muzzle (±6px).
    g.poly([-9, -8, -6, -42, 6, -42, 9, -8]).fill({ color: 0x2c2e3a });
    // Shadowed right half + a thin highlight strip on the left edge fake a
    // cylindrical light wrap without a real gradient fill.
    g.poly([0, -8, 1, -42, 6, -42, 9, -8]).fill({ color: 0x1a1b23 });
    g.roundRect(-7.5, -40, 2, 32, 1).fill({ color: 0x565970, alpha: 0.7 });

    // Reinforcement bands.
    g.roundRect(-8.5, -28, 17, 3, 1).fill({ color: 0x121319 });
    g.roundRect(-7.5, -17, 15, 3, 1).fill({ color: 0x121319 });

    // Muzzle: a metallic rim around a dark bore.
    g.ellipse(0, -42, 7.5, 3.2).fill({ color: 0x40434f }).stroke({ width: 1, color: 0x6c7086, alpha: 0.6 });
    g.ellipse(0, -42, 4.6, 2).fill({ color: 0x07080b });
  }

  private drawFlash(g: Graphics): void {
    g.circle(0, -44, 16).fill({ color: 0xfff3c4, alpha: 0.9 });
  }

  private layout(): void {
    const { width, height } = this.app.screen;
    const spacing = width / (STATION_COUNT + 1);
    this.stations.forEach((station, i) => {
      station.x = spacing * (i + 1);
      station.base.position.set(station.x, height);
      station.flash.position.set(station.x, height);
    });
  }

  /** Flashes/recoils whichever tube sits closest to `x` — cosmetic only. */
  fireNear(x: number): void {
    const nearest = this.findNearest(x);
    nearest.flashTimer = FLASH_FRAMES;
    nearest.flash.visible = true;
  }

  /** The x-coordinate of the tube closest to `x` — used by Mortar Field input mode. */
  getNearestX(x: number): number {
    return this.findNearest(x).x;
  }

  private findNearest(x: number): Station {
    let nearest = this.stations[0];
    let bestDistance = Infinity;
    for (const station of this.stations) {
      const distance = Math.abs(station.x - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = station;
      }
    }
    return nearest;
  }

  update(delta: number): void {
    if (!this.container.visible) return;
    for (const station of this.stations) {
      if (station.flashTimer <= 0) continue;

      station.flashTimer -= delta;
      const t = Math.max(station.flashTimer, 0) / FLASH_FRAMES;
      station.flash.alpha = t;
      station.base.scale.y = 0.9 + 0.1 * (1 - t);

      if (station.flashTimer <= 0) {
        station.flash.visible = false;
        station.base.scale.y = 1;
      }
    }
  }
}

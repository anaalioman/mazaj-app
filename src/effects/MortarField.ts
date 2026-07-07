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
 */
export class MortarField {
  private readonly app: Application;
  readonly container: Container;
  private stations: Station[] = [];

  constructor(app: Application) {
    this.app = app;
    this.container = new Container();
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

  private drawTube(g: Graphics): void {
    g.roundRect(-9, -34, 18, 34, 3).fill({ color: 0x1c1d24 });
    g.roundRect(-11, -6, 22, 10, 2).fill({ color: 0x111217 });
    g.circle(0, -34, 10).fill({ color: 0x2a2c36 });
  }

  private drawFlash(g: Graphics): void {
    g.circle(0, -40, 16).fill({ color: 0xfff3c4, alpha: 0.9 });
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

import type { Application, Container } from 'pixi.js';
import { ShockwaveFilter } from 'pixi-filters';

const DURATION_SECONDS = 0.5;
const SPEED = 1500; // px/sec — expands very fast
const INITIAL_AMPLITUDE = 14; // deliberately light/subtle refraction
const WAVELENGTH = 140;

interface ActiveWave {
  filter: ShockwaveFilter;
  age: number;
}

/**
 * Shockwave Distortion: a light, fast-expanding ring of refraction fired
 * from each rocket's main explosion point. Applied as a filter on
 * `worldContainer` (see fireworksMood.ts's own container-tree doc comment)
 * so it visually bends the background, stars, and surrounding particles as
 * it passes over them, fading out (amplitude -> 0) as it expands outward —
 * deliberately never the header/icon-column/panels sitting in the sibling
 * `uiContainer`, matching this class's own original intent (a distortion
 * of the *scene*, not the controls drawn on top of it). This also means
 * the effect is visible to the secondary worldContainer-only renderer used
 * for video recording, without any extra wiring.
 */
export class ShockwaveManager {
  private readonly app: Application;
  private readonly worldContainer: Container;
  private active: ActiveWave[] = [];

  constructor(app: Application, worldContainer: Container) {
    this.app = app;
    this.worldContainer = worldContainer;
  }

  /** Call once per rocket's main explosion (not for secondary splits/glitter). */
  trigger(x: number, y: number): void {
    const maxRadius = Math.hypot(this.app.screen.width, this.app.screen.height) * 1.2;
    const filter = new ShockwaveFilter({
      center: { x, y },
      speed: SPEED,
      amplitude: INITIAL_AMPLITUDE,
      wavelength: WAVELENGTH,
      brightness: 1,
      radius: maxRadius,
      time: 0,
    });
    this.active.push({ filter, age: 0 });
    this.syncFilters();
  }

  update(deltaSeconds: number): void {
    if (this.active.length === 0) return;

    const beforeCount = this.active.length;
    this.active = this.active.filter((wave) => {
      wave.age += deltaSeconds;
      wave.filter.time = wave.age;
      // Fades as it expands, rather than staying at full strength until it
      // simply stops existing.
      wave.filter.amplitude = INITIAL_AMPLITUDE * Math.max(0, 1 - wave.age / DURATION_SECONDS);
      return wave.age < DURATION_SECONDS;
    });

    if (this.active.length !== beforeCount) this.syncFilters();
  }

  private syncFilters(): void {
    this.worldContainer.filters = this.active.length > 0 ? this.active.map((wave) => wave.filter) : null;
  }
}

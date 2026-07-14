import { Application, Graphics } from 'pixi.js';

const PEAK_ALPHA = 0.5; // "very transparent white" — not a full whiteout
const DECAY_PER_SECOND = 7; // linear decay: ~70ms from peak to fully gone

/**
 * A single full-screen white overlay that instantly bumps brighter on every
 * rocket's main explosion and decays almost immediately — simulating the
 * sudden ambient light of a real firework burst lighting up the sky. One
 * shared overlay handles overlapping explosions gracefully (it just gets
 * brighter, capped at 1, instead of stacking separate flash objects).
 */
export class ScreenFlash {
  private readonly app: Application;
  /** Public so fireworksMood.ts can reparent it into worldContainer (ambient explosion lighting is legitimate scene content, unlike the camera-style UI flash — see fireworksMood.ts's own container-tree doc comment). */
  readonly graphics: Graphics;

  constructor(app: Application) {
    this.app = app;
    this.graphics = new Graphics();
    this.graphics.alpha = 0;
    this.redraw();
    app.stage.addChild(this.graphics);
    app.renderer.on('resize', () => this.redraw());
  }

  /** Call once per rocket's main explosion (not for secondary splits/glitter). */
  flash(): void {
    this.graphics.alpha = Math.min(1, this.graphics.alpha + PEAK_ALPHA);
  }

  update(deltaSeconds: number): void {
    if (this.graphics.alpha <= 0) return;
    this.graphics.alpha = Math.max(0, this.graphics.alpha - DECAY_PER_SECOND * deltaSeconds);
  }

  private redraw(): void {
    const { width, height } = this.app.screen;
    this.graphics.clear();
    this.graphics.rect(0, 0, width, height).fill({ color: 0xffffff });
  }
}

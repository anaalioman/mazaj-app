import type { Application } from 'pixi.js';

// Below this burst intensity nothing shakes at all — only large/dense
// explosions (peony, rose, multi-ring, big hybrids) should punch the camera;
// thin bursts (a handful of crossette arms) stay perfectly still.
const MIN_INTENSITY = 0.35;
const MAX_OFFSET_PX = 10;
const BASE_DURATION_SECONDS = 0.28;

/**
 * A tiny, cheap camera-shake: nudges `app.stage.position` with a decaying
 * random offset for a fraction of a second, then snaps back to (0, 0).
 * O(1) per frame, no extra sprites/textures — safe on mid-range Android.
 */
export class ScreenShakeManager {
  private readonly app: Application;
  private age = 0;
  private duration = 0;
  private magnitude = 0;

  constructor(app: Application) {
    this.app = app;
  }

  /** `intensity` is roughly 0-1.5 (see FireworksSystem's onExplode). */
  trigger(intensity: number): void {
    if (intensity < MIN_INTENSITY) return;

    const clamped = Math.min(intensity, 1.5);
    const nextMagnitude = MAX_OFFSET_PX * clamped;
    // A smaller burst landing while a bigger one is still shaking shouldn't
    // weaken/reset it — only escalate, never downgrade an active shake.
    if (this.age < this.duration && nextMagnitude < this.magnitude) return;

    this.magnitude = nextMagnitude;
    this.duration = BASE_DURATION_SECONDS * (0.75 + clamped * 0.25);
    this.age = 0;
  }

  update(deltaSeconds: number): void {
    if (this.age >= this.duration) {
      if (this.app.stage.position.x !== 0 || this.app.stage.position.y !== 0) {
        this.app.stage.position.set(0, 0);
      }
      return;
    }

    this.age += deltaSeconds;
    if (this.age >= this.duration) {
      this.app.stage.position.set(0, 0);
      return;
    }

    const remaining = 1 - this.age / this.duration;
    const eased = remaining * remaining; // ease-out: sharp punch, quick settle
    const currentMagnitude = this.magnitude * eased;
    const angle = Math.random() * Math.PI * 2;
    this.app.stage.position.set(Math.cos(angle) * currentMagnitude, Math.sin(angle) * currentMagnitude);
  }
}

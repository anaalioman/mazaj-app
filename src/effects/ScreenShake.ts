import type { Container } from 'pixi.js';
import { fastCos, fastSin, TWO_PI } from '../fireworks/SineTable';

// Below this burst intensity nothing shakes at all — only large/dense
// explosions (peony, rose, multi-ring, big hybrids) should punch the camera;
// thin bursts (a handful of crossette arms) stay perfectly still.
const MIN_INTENSITY = 0.35;
const MAX_OFFSET_PX = 10;
const BASE_DURATION_SECONDS = 0.28;

// Static noise table, built once at module load — same convention as every
// fireworks pattern file. A shake only draws one value per frame for its own
// short ~0.28-0.35s duration, so 256 slots is comfortable headroom; stride
// stays prime (131), coprime with the power-of-two table size.
const RANDOM_TABLE_SIZE = 256;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

/**
 * A tiny, cheap camera-shake: nudges `worldContainer.position` (see
 * fireworksMood.ts's own container-tree doc comment) with a decaying random
 * offset for a fraction of a second, then snaps back to (0, 0). Targeting
 * `worldContainer` instead of `app.stage` keeps the header/icon-column/
 * panels in the sibling `uiContainer` perfectly steady during a shake (a
 * random nudge mid-tap on a small icon is bad UX, not "juice"), and means
 * the shake is visible to the secondary worldContainer-only renderer used
 * for video recording. O(1) per frame, no extra sprites/textures — safe on
 * mid-range Android.
 */
export class ScreenShakeManager {
  private readonly worldContainer: Container;
  private age = 0;
  private duration = 0;
  private magnitude = 0;
  /** Persistent walking cursor into the static `randomTable` — see `nextRand()`. */
  private rIdx = 0;

  constructor(worldContainer: Container) {
    this.worldContainer = worldContainer;
  }

  /** Walks `randomTable` one step — zero live `Math.random()` calls. */
  private nextRand(): number {
    this.rIdx = (this.rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[this.rIdx];
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
      if (this.worldContainer.position.x !== 0 || this.worldContainer.position.y !== 0) {
        this.worldContainer.position.set(0, 0);
      }
      return;
    }

    this.age += deltaSeconds;
    if (this.age >= this.duration) {
      this.worldContainer.position.set(0, 0);
      return;
    }

    const remaining = 1 - this.age / this.duration;
    const eased = remaining * remaining; // ease-out: sharp punch, quick settle
    const currentMagnitude = this.magnitude * eased;
    const angle = this.nextRand() * TWO_PI;
    this.worldContainer.position.set(fastCos(angle) * currentMagnitude, fastSin(angle) * currentMagnitude);
  }
}

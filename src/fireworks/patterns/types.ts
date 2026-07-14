import type { Particle, ParticleOptions } from '../Particle';
import type { BurstSettings } from '../burstTypes';

/**
 * Everything a burst-pattern function needs from FireworksSystem, passed in
 * explicitly instead of the pattern being a method on the class — each
 * pattern file (Peony.ts, Kamuro.ts, Heart.ts, ...) is a plain, independently
 * readable function with no hidden coupling to FireworksSystem's internals.
 */
export interface BurstContext {
  /**
   * Constructs one particle through the shared `trailsContainer`/
   * `coresContainer` pair and registers it against this explosion's own
   * completion-tracking batch (if any, e.g. `launch()`'s `onComplete`) —
   * every pattern spawns exclusively through this, never `new Particle(...)`
   * directly.
   */
  spawn: (options: ParticleOptions) => Particle;
  settings: BurstSettings;
  /** The player's "dye this shell" color-picker choice, or `null` for the normal random palettes — see FireworksSystem's own `activeColor` doc comment. */
  activeColor: number | null;
  /** `settings.particleDensity / DEFAULT_BURST_SETTINGS.particleDensity`, precomputed once per burst call. */
  densityRatio: number;
  /** `1 + settings.glow * 0.05`, precomputed once per burst call. */
  glowSizeBoost: number;
  /** See FireworksSystem's own doc comment: samples speed uniformly across the full 0..maxSpeed range so bursts fill with real depth instead of reading as a hollow shell. */
  fillSpeed: (maxSpeed: number, minRatio?: number) => number;
}

/** One burst pattern: spawns whatever particles it needs, synchronously, from the explosion center `(x, y)`. */
export type BurstPattern = (x: number, y: number, ctx: BurstContext) => void;

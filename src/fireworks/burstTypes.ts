/**
 * Shared burst-pattern types — split out from FireworksSystem.ts so the
 * pattern files under `patterns/` (Peony.ts, Kamuro.ts, Heart.ts, ...) can
 * import `BurstType`/`BurstSettings` without importing FireworksSystem.ts
 * itself (which imports the pattern registry back) — a real circular
 * import, not just a type-only one, since FireworksSystem.ts needs the
 * registry's actual runtime values.
 */

export type BurstType = 'peony' | 'rose' | 'kamuro' | 'crossette' | 'multiRing' | 'strobe' | 'heart';
export const ALL_BURST_TYPES: BurstType[] = ['peony', 'rose', 'kamuro', 'crossette', 'multiRing', 'strobe', 'heart'];

export interface BurstSettings {
  /** Baseline particle count per burst (control panel: 50-500, default 150). */
  particleDensity: number;
  /** Multiplier on the downward pull applied to burst sparks. */
  gravityScale: number;
  /** Multiplier on how long fragments linger before fading. */
  lifespanScale: number;
  /** Multiplier on initial burst velocity / spread radius. */
  explosionScale: number;
  /** 0-10: trail thickness + a screen-space glow (blur) on the particle layer. */
  glow: number;
}

// Richer out-of-the-box feel: denser bursts, a slower "royal" gravitational
// fall, and a longer-lingering glow, without changing any slider's own
// range — see the matching SLIDERS defaults in PlanningScreen.ts, which
// must stay in sync with these (the sliders' initial handle position has to
// reflect the engine's actual starting state, not a stale one).
//
// particleDensity raised again (240->320) after Particle.ts/FireworksSystem.ts
// switched to a real object pool (see FireworksSystem's `deadPool` doc
// comment) — measured spawn-loop cost with a warm pool dropped to 0-1ms per
// burst across every pattern (down from up to 8ms cold), so there's real,
// measured headroom for this increase, not a guess.
export const DEFAULT_BURST_SETTINGS: BurstSettings = {
  particleDensity: 320,
  gravityScale: 0.6,
  lifespanScale: 1.7,
  explosionScale: 1,
  glow: 4,
};

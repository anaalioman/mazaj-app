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

export const DEFAULT_BURST_SETTINGS: BurstSettings = {
  particleDensity: 150,
  gravityScale: 1,
  lifespanScale: 1,
  explosionScale: 1,
  glow: 2,
};

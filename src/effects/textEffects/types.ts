import type { Container, Text, Texture } from 'pixi.js';

export type TextRevealEffect = 'smoke' | 'flame' | 'inferno' | 'neon' | 'glitch' | 'spark' | 'none';

export interface TextEffectContext {
  /** Already added to the stage — effects add their own particles/ghosts as children here. */
  container: Container;
  /** Already positioned/sized/styled at its final resting spot — effects control its alpha/tint, never its position or size. */
  text: Text;
  /** The shared soft round particle texture used everywhere else in the app. */
  particleTexture: Texture;
}

/**
 * One playable text-reveal effect. `play()` spawns whatever the effect
 * needs and resolves once the text is in its final, fully-revealed state;
 * `update()` is called every tick for as long as the effect is active;
 * `clear()` must remove everything the effect added, safe to call at any
 * time (including before `play()` ever ran, or mid-animation).
 */
export interface TextEffect {
  play(ctx: TextEffectContext): Promise<void>;
  update(delta: number): void;
  clear(): void;
}

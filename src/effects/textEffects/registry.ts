import type { TextEffect, TextRevealEffect } from './types';
import { SmokeEffect } from './smoke';
import { FlameEffect } from './flame';
import { InfernoEffect } from './inferno';
import { NeonEffect } from './neon';
import { GlitchEffect } from './glitch';
import { SparkEffect } from './spark';
import { NoneEffect } from './none';

export type { TextRevealEffect, TextEffect, TextEffectContext } from './types';

export interface TextEffectEntry {
  id: TextRevealEffect;
  /** Arabic label shown under its preview box in the composer's effects bar. */
  label: string;
  create: () => TextEffect;
}

/**
 * Single source of truth for every text-reveal effect: its id, its Arabic
 * label, and how to build a fresh instance. Adding a new effect means
 * writing one more `TextEffect` module and adding one entry here — nothing
 * else (TextReveal, TextComposer's effects bar, the preview cycle) needs to
 * change, they all just iterate this list.
 */
export const TEXT_EFFECTS: TextEffectEntry[] = [
  { id: 'smoke', label: 'دخان يكشف', create: () => new SmokeEffect() },
  { id: 'flame', label: 'لهب يكشف', create: () => new FlameEffect() },
  { id: 'inferno', label: 'اللهب المتطور', create: () => new InfernoEffect() },
  { id: 'neon', label: 'وميض نيون ملون', create: () => new NeonEffect() },
  { id: 'glitch', label: 'خلل رقمي', create: () => new GlitchEffect() },
  { id: 'spark', label: 'شرار متفجر', create: () => new SparkEffect() },
  { id: 'none', label: 'بدون تأثير', create: () => new NoneEffect() },
];

export function createTextEffect(id: TextRevealEffect): TextEffect {
  const entry = TEXT_EFFECTS.find((e) => e.id === id) ?? TEXT_EFFECTS[0];
  return entry.create();
}

import type { TextEffect, TextEffectContext } from './types';

/** "بدون تأثير" — shows the text immediately, no particles at all. */
export class NoneEffect implements TextEffect {
  async play(ctx: TextEffectContext): Promise<void> {
    ctx.text.alpha = 1;
  }

  update(): void {
    // nothing to animate
  }

  clear(): void {
    // nothing was spawned
  }
}

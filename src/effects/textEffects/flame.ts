import { DissolveCloudEffect } from './dissolveCloud';

/** "لهب يكشف" — an orange flame cloud billows around the text and clears to reveal it. */
export class FlameEffect extends DissolveCloudEffect {
  protected readonly colors = [0xff7a3c, 0xffb04c, 0xff5a3c];
}

import { DissolveCloudEffect } from './dissolveCloud';

/** "دخان يكشف" — a grey smoke cloud billows around the text and clears to reveal it. */
export class SmokeEffect extends DissolveCloudEffect {
  protected readonly colors = [0xbfbfbf, 0x9a9a9a, 0xe0e0e0];
}

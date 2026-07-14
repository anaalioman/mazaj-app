import type { BurstType } from '../burstTypes';
import type { BurstPattern } from './types';
import { burstPeony } from './Peony';
import { burstRose } from './Rose';
import { burstKamuro } from './Kamuro';
import { burstPalmCrossette } from './Crossette';
import { burstMultiRing } from './MultiRing';
import { burstStrobe } from './Strobe';
import { burstHeart } from './Heart';

export const BURST_PATTERNS: Record<BurstType, BurstPattern> = {
  peony: burstPeony,
  rose: burstRose,
  kamuro: burstKamuro,
  crossette: burstPalmCrossette,
  multiRing: burstMultiRing,
  strobe: burstStrobe,
  heart: burstHeart,
};

export type { BurstContext, BurstPattern } from './types';

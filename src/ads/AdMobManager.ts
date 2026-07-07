import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdPosition,
  BannerAdSize,
  type BannerAdOptions,
} from '@capacitor-community/admob';
import type { Entitlements } from '../billing/Entitlements';

// Google's official Android test ad unit IDs (https://developers.google.com/admob/android/test-ads).
// Safe to ship in debug builds; MUST be swapped for real AdMob ad unit IDs before any release build.
const TEST_AD_UNITS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

/**
 * Thin wrapper around @capacitor-community/admob. Every method checks
 * `removeAds` on Entitlements first and no-ops if the player purchased it,
 * and no-ops entirely on web/dev where the native AdMob SDK isn't present.
 */
export class AdMobManager {
  private readonly entitlements: Entitlements;
  private initialized = false;

  constructor(entitlements: Entitlements) {
    this.entitlements = entitlements;
  }

  async initialize(): Promise<void> {
    if (!this.isSupported()) return;
    await AdMob.initialize({ initializeForTesting: import.meta.env.DEV });
    this.initialized = true;
  }

  async showBanner(): Promise<void> {
    if (!this.canShowAds()) return;
    const options: BannerAdOptions = {
      adId: TEST_AD_UNITS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      isTesting: import.meta.env.DEV,
    };
    await AdMob.showBanner(options);
  }

  async hideBanner(): Promise<void> {
    if (!this.initialized) return;
    await AdMob.hideBanner();
  }

  async showInterstitial(): Promise<void> {
    if (!this.canShowAds()) return;
    await AdMob.prepareInterstitial({ adId: TEST_AD_UNITS.interstitial, isTesting: import.meta.env.DEV });
    await AdMob.showInterstitial();
  }

  /** Rewarded ads stay available even for players who bought "remove ads" — they opted in. */
  async showRewardedAd(): Promise<boolean> {
    if (!this.initialized) return false;
    await AdMob.prepareRewardVideoAd({ adId: TEST_AD_UNITS.rewarded, isTesting: import.meta.env.DEV });
    const result = await AdMob.showRewardVideoAd();
    return Boolean(result);
  }

  private canShowAds(): boolean {
    return this.initialized && !this.entitlements.has('removeAds');
  }

  private isSupported(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }
}

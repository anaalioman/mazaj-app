import { Entitlements } from './billing/Entitlements';
import { BillingManager } from './billing/BillingManager';
import { AdMobManager } from './ads/AdMobManager';

// Shared singletons: every mood/UI piece that needs to check an entitlement
// or trigger a purchase/ad should import these rather than constructing its
// own instance, so there's exactly one Play Billing/AdMob session per app run.
export const entitlements = new Entitlements();
export const billing = new BillingManager(entitlements);
export const adMob = new AdMobManager(entitlements);

/** Boots the native SDKs; safe to call unconditionally (no-ops on web/dev). */
export async function initializeMonetization(): Promise<void> {
  await Promise.all([billing.initialize(), adMob.initialize()]);
}

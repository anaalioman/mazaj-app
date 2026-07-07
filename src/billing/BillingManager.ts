import { Capacitor } from '@capacitor/core';
import { Entitlements } from './Entitlements';
import { ALL_PRODUCT_IDS, PRODUCT_TO_ENTITLEMENT, type ProductId } from './products';

/**
 * Thin wrapper around cordova-plugin-purchase (talks directly to the Google
 * Play Billing Library — no third-party IAP backend). Registers مزاج's
 * product catalog, wires the standard approve → verify → finish flow, and
 * grants the matching Entitlements flag once Google Play confirms a purchase.
 *
 * No-ops everywhere on web/dev so the rest of the app can call it
 * unconditionally without platform checks.
 */
export class BillingManager {
  private readonly entitlements: Entitlements;
  private store: CdvPurchaseStore | null = null;
  private ready = false;

  constructor(entitlements: Entitlements) {
    this.entitlements = entitlements;
  }

  async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    const store = await this.waitForStore();
    if (!store) {
      console.warn('CdvPurchase غير متاح — تأكد من تشغيل `npx cap sync android` بعد تثبيت الإضافة.');
      return;
    }
    this.store = store;

    store.register(
      ALL_PRODUCT_IDS.map((id) => ({
        id,
        platform: 'android-playstore',
        type: 'non consumable',
      })),
    );

    store
      .when()
      .approved((transaction) => transaction.verify())
      .verified((receipt) => receipt.finish())
      .finished((transaction) => {
        for (const { id } of transaction.products) {
          const entitlement = PRODUCT_TO_ENTITLEMENT[id as ProductId];
          if (entitlement) this.entitlements.grant(entitlement);
        }
      });

    await store.initialize(['android-playstore']);
    this.ready = true;
  }

  /** Starts the Google Play purchase flow for the given product. */
  async purchase(productId: ProductId): Promise<void> {
    if (!this.ready || !this.store) {
      console.warn('المتجر غير جاهز بعد — لا يمكن إتمام الشراء.');
      return;
    }
    const product = this.store.get(productId);
    const offer = product?.getOffer();
    if (!offer) {
      console.warn(`لا يوجد عرض متاح للمنتج: ${productId}`);
      return;
    }
    const error = await offer.order();
    if (error) console.error('فشل الشراء:', error.message);
  }

  /** Restores previously-owned non-consumables (e.g. after a reinstall). */
  async restore(): Promise<void> {
    if (!this.ready || !this.store) return;
    const error = await this.store.restorePurchases();
    if (error) console.error('فشلت استعادة المشتريات:', error.message);
  }

  private waitForStore(): Promise<CdvPurchaseStore | null> {
    if (window.CdvPurchase) return Promise.resolve(window.CdvPurchase.store);

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => resolve(null), 5000);
      document.addEventListener(
        'deviceready',
        () => {
          window.clearTimeout(timeout);
          resolve(window.CdvPurchase?.store ?? null);
        },
        { once: true },
      );
    });
  }
}

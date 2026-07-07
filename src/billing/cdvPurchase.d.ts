// Minimal ambient typings for the slice of cordova-plugin-purchase's runtime
// API (window.CdvPurchase) that BillingManager actually uses. The plugin
// attaches this global itself once Capacitor's Cordova-compatibility layer
// loads www/store.js after `deviceready` on a native platform — it is never
// imported as an ES module, so these types stay hand-written rather than
// pulling in the package's full (5000+ line) declaration file.

interface CdvPurchaseError {
  isError: true;
  code: number;
  message: string;
}

interface CdvPurchaseOffer {
  order(): Promise<CdvPurchaseError | undefined>;
}

interface CdvPurchaseProduct {
  id: string;
  canPurchase: boolean;
  owned: boolean;
  getOffer(id?: string): CdvPurchaseOffer | undefined;
}

interface CdvPurchaseReceipt {
  finish(): Promise<void>;
}

interface CdvPurchaseTransaction {
  products: { id: string; offerId?: string }[];
  verify(): Promise<void>;
}

interface CdvPurchaseWhen {
  approved(cb: (transaction: CdvPurchaseTransaction) => void): CdvPurchaseWhen;
  verified(cb: (receipt: CdvPurchaseReceipt) => void): CdvPurchaseWhen;
  finished(cb: (transaction: CdvPurchaseTransaction) => void): CdvPurchaseWhen;
  unverified(cb: (receipt: unknown) => void): CdvPurchaseWhen;
}

interface CdvPurchaseRegisterProduct {
  id: string;
  platform: 'android-playstore';
  type: 'non consumable' | 'consumable';
}

interface CdvPurchaseStore {
  register(products: CdvPurchaseRegisterProduct[]): void;
  initialize(platforms?: 'android-playstore'[]): Promise<CdvPurchaseError[]>;
  when(): CdvPurchaseWhen;
  get(productId: string): CdvPurchaseProduct | undefined;
  owned(productId: string): boolean;
  restorePurchases(): Promise<CdvPurchaseError | undefined>;
  verbosity: number;
}

interface CdvPurchaseGlobal {
  store: CdvPurchaseStore;
}

interface Window {
  CdvPurchase?: CdvPurchaseGlobal;
}

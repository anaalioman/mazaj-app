export type EntitlementId = 'removeAds' | 'unlockBurstPack' | 'videoExportHD';

const STORAGE_KEY = 'mzj-entitlements-v1';

type EntitlementState = Record<EntitlementId, boolean>;

const DEFAULT_STATE: EntitlementState = {
  removeAds: false,
  unlockBurstPack: false,
  videoExportHD: false,
};

type Listener = (state: Readonly<EntitlementState>) => void;

/**
 * Single source of truth for what the player has unlocked. Persisted to
 * localStorage so entitlements survive app restarts without a backend.
 * BillingManager is the only caller that should invoke `grant()`, once a
 * purchase has actually been verified/finished by Google Play.
 */
export class Entitlements {
  private state: EntitlementState;
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.state = this.load();
  }

  has(id: EntitlementId): boolean {
    return this.state[id];
  }

  grant(id: EntitlementId): void {
    if (this.state[id]) return;
    this.state = { ...this.state, [id]: true };
    this.persist();
    this.notify();
  }

  /** Subscribes to entitlement changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private load(): EntitlementState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // localStorage unavailable (private mode, etc.) — entitlement still holds for this session.
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

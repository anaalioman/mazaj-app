/** Google Play product IDs — must match the SKUs created in Play Console before release. */
export const PRODUCT_IDS = {
  removeAds: 'mzj_remove_ads',
  unlockBurstPack: 'mzj_unlock_burst_pack',
  videoExportHD: 'mzj_video_export_hd',
} as const;

export type ProductId = (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS];

/** Maps each store product to the entitlement it grants once purchased. */
export const PRODUCT_TO_ENTITLEMENT: Record<ProductId, import('./Entitlements').EntitlementId> = {
  [PRODUCT_IDS.removeAds]: 'removeAds',
  [PRODUCT_IDS.unlockBurstPack]: 'unlockBurstPack',
  [PRODUCT_IDS.videoExportHD]: 'videoExportHD',
};

export const ALL_PRODUCT_IDS: ProductId[] = Object.values(PRODUCT_IDS);

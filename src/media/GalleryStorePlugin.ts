import { registerPlugin } from '@capacitor/core';

export interface GalleryStorePlugin {
  /** Saves a PNG data URL straight into the public Pictures/مزاج MediaStore album. Native Android only — see GalleryStorePlugin.java for the API 29+/legacy split. */
  savePhoto(options: { dataUrl: string; fileName?: string }): Promise<void>;
}

export const GalleryStore = registerPlugin<GalleryStorePlugin>('GalleryStore');

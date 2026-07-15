import { Capacitor } from '@capacitor/core';
import { GalleryStore } from './GalleryStorePlugin';

// Writes directly into the public Pictures/مزاج MediaStore album via a
// small custom native plugin (see GalleryStorePlugin.java) — a real system
// gallery location that survives the app being uninstalled, unlike
// @capacitor-community/media's fixed Android/media/<package>/ path (an
// app-scoped directory the system wipes on uninstall same as private
// storage). No storage permission is requested on Android 10+ (scoped
// storage lets any app insert its own new MediaStore content for free);
// only this app's minSdkVersion floor (24-28) needs one, handled inside the
// native plugin itself.

/** True only inside the real Android/iOS app — GalleryStore has no web implementation, see saveSnapshotToGallery()'s own doc comment for the browser fallback this gates. */
export function canSaveToGallery(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Saves a PNG data URL (exactly what `renderer.extract.base64()` already
 * produces) straight into the device's own photo gallery — no download
 * prompt, no file-picker, no "Downloads" folder detour. Only call this
 * behind `canSaveToGallery()`; the underlying plugin has no web
 * implementation at all (fireworksMood.ts's takeSnapshot() falls back to
 * the ordinary `<a download>` browser pattern there instead, since a plain
 * web page has no OS gallery to write into in the first place).
 */
export async function saveSnapshotToGallery(dataUrl: string): Promise<void> {
  await GalleryStore.savePhoto({ dataUrl, fileName: `mazaj-${Date.now()}` });
}

import { Capacitor } from '@capacitor/core';
import { Media } from '@capacitor-community/media';

// A dedicated album keeps every exported shot together in the device's own
// gallery app instead of scattering into a generic "Downloads"/"Pictures"
// bucket — and critically, savePhoto() to an app-created album needs zero
// storage permissions on Android (the plugin only requests broader access
// when `androidGalleryMode` is turned on in capacitor.config.ts, which this
// app deliberately never does — it only ever needs to *write* its own
// shots, never read the rest of the device's photos).
const ALBUM_NAME = 'مزاج';

let albumIdentifierPromise: Promise<string> | null = null;

async function getOrCreateAlbum(): Promise<string> {
  const { albums } = await Media.getAlbums();
  const existing = albums.find((album) => album.name === ALBUM_NAME);
  if (existing) return existing.identifier;

  await Media.createAlbum({ name: ALBUM_NAME });
  const { albums: refreshed } = await Media.getAlbums();
  const created = refreshed.find((album) => album.name === ALBUM_NAME);
  if (!created) throw new Error(`تعذّر إنشاء ألبوم "${ALBUM_NAME}"`);
  return created.identifier;
}

/** True only inside the real Android/iOS app — savePhoto() has no web implementation, see saveSnapshotToGallery()'s own doc comment for the browser fallback this gates. */
export function canSaveToGallery(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Saves a PNG data URL (exactly what `renderer.extract.base64()` already
 * produces) straight into the device's own photo gallery — no download
 * prompt, no file-picker, no "Downloads" folder detour. Only call this
 * behind `canSaveToGallery()`; the underlying plugin has no web
 * implementation at all (fireworksMood.ts's takeSnapshot() falls back to
 * the ordinary `<a download>` browser pattern there instead, since a
 * plain web page has no OS gallery to write into in the first place).
 */
export async function saveSnapshotToGallery(dataUrl: string): Promise<void> {
  albumIdentifierPromise ??= getOrCreateAlbum();
  try {
    const albumIdentifier = await albumIdentifierPromise;
    await Media.savePhoto({ path: dataUrl, albumIdentifier, fileName: `mazaj-${Date.now()}` });
  } catch (error) {
    // Don't let one failed attempt (e.g. a transient permission hiccup)
    // permanently wedge every future snapshot on an already-rejected
    // promise — the next tap gets a clean retry instead.
    albumIdentifierPromise = null;
    throw error;
  }
}

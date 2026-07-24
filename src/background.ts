import { Application, BlurFilter, Container, FillGradient, Graphics, Sprite, Texture } from 'pixi.js';
import { fastSin, TWO_PI } from './fireworks/SineTable';
import { createDecodedImageElement, createLiveStreamVideoElement, createLoopingVideoElement } from './dom/shadowServices';

// Deep Sky Canvas palette.
const SKY_TOP = 0x000000; // True black at the zenith — the darkest a screen can show, so nothing above the horizon glow ever reads as washed out.
const SKY_BOTTOM = 0x0a0c16; // Deepened from the previous 0x0f111a — still a real navy-indigo (not flat black, so the gradient itself is visible), but noticeably richer/darker than before.
const HORIZON_GLOW_COLOR = '124, 58, 190'; // Richer, more saturated violet-magenta than the previous desaturated indigo (91, 74, 181) — reads as genuinely radiant against the deeper black instead of pale.
const HORIZON_GLOW_PEAK_ALPHA = 0.62; // Raised from 0.55 to match the richer color above.
/** Warm gold, matching the app's own established gold identity (HomeScreen's GOLD/card-title colors) — twinkling stars read as golden points of light rather than plain white. */
const STAR_COLOR = 0xffe9b3;
const STAR_MIN_COUNT = 50;
const STAR_MAX_COUNT = 80;
// Confines stars to the screen's upper third (fracY in [0, 1/3)) — up against
// the very top edge — narrower than the previous half-screen band, so they
// read as a distant, high band of sky rather than crowding toward the middle.
// Depth still comes from correlating size/brightness with fracY (buildStars()).
const STAR_UPPER_BAND = 1 / 3;
const TWINKLE_SPEED = 0.02;

interface TwinkleStar {
  display: Graphics;
  /** Position as a fraction of screen width/height (0..1) — redrawn against the *current* screen size on resize instead of destroying/rebuilding the star from scratch. */
  fracX: number;
  fracY: number;
  radius: number;
  baseAlpha: number;
  speed: number;
  /** Radians in `[0, TWO_PI)` — incrementally advanced and wrapped once per frame in `updateTwinkle()` (same convention as `Particle.ts`'s own `twinkleTimer`), never re-derived via a live `Math.sin()`/modulo of an unboundedly-growing clock. */
  wavePos: number;
}

function coverFit(sprite: Sprite, width: number, height: number): void {
  const scale = Math.max(width / sprite.texture.width, height / sprite.texture.height);
  sprite.width = sprite.texture.width * scale;
  sprite.height = sprite.texture.height * scale;
  sprite.position.set(width / 2, height / 2);
}

/** Maps 0..1 to an equal-channel gray hex (0x000000 black .. 0xffffff white). */
function grayscaleTint(brightness: number): number {
  const channel = Math.round(Math.max(0, Math.min(1, brightness)) * 255);
  return (channel << 16) | (channel << 8) | channel;
}

/**
 * Owns whatever sits behind the show — the Deep Sky Canvas (gradient +
 * horizon glow + twinkling stars), an uploaded photo, or a looping video —
 * plus the dimmer applied to it. It always sits at index 0 of the `parent`
 * container it's given (fireworksMood.ts's `worldContainer` — see that
 * file's own container-tree doc comment), safely behind the fireworks and
 * mortar layers added on top of it later, and never inside `uiContainer`.
 *
 * Swapping the backdrop or dimming it never touches per-pixel CPU work:
 * cover-fit is a transform and dimming is a GPU tint multiply, so neither
 * costs frames. The only per-frame cost is the twinkle animation, which is
 * just a handful of `alpha` writes driven by `SineTable`'s precomputed
 * table (see `updateTwinkle()`) — zero live `Math.sin()` calls.
 */
export class BackgroundLayer {
  private readonly app: Application;
  private readonly parent: Container;
  private current: Container;
  private currentSprite: Sprite | null = null;
  private videoEl: HTMLVideoElement | null = null;
  /** Only set when the current video is a live getUserMedia feed (توثيق مباشر) — its tracks must be stopped explicitly to actually release the camera. */
  private videoStream: MediaStream | null = null;
  /** The blob URL backing the current user-uploaded video (setVideo()) — null for a live-camera or no-video backdrop. Deliberately not revoked at creation (the <video> element streams from it while active); stopVideo() revokes whatever this holds so switching away from a video backdrop never leaks its blob. */
  private videoObjectUrl: string | null = null;
  private dimmer = 1;

  private stars: TwinkleStar[] = [];

  // The Deep Sky Canvas's own persistent Graphics/gradients/filter — redrawn
  // in place at the new size on resize (see handleResize()) instead of being
  // destroyed and rebuilt from scratch every time, matching the same
  // zero-allocation-in-resize-path discipline already applied elsewhere in
  // this codebase (HeaderBar.ts's filterMask, FireworksSystem.ts's
  // filterArea). Only actually populated while the Deep Sky Canvas — not a
  // photo/video — is the current backdrop; see clearDeepSkyRefs().
  private skyGraphics: Graphics | null = null;
  private skyGradient: FillGradient | null = null;
  private horizonGraphics: Graphics | null = null;
  private horizonGradient: FillGradient | null = null;

  constructor(app: Application, parent: Container) {
    this.app = app;
    this.parent = parent;
    this.current = this.buildDeepSky();
    parent.addChildAt(this.current, 0);
    app.renderer.on('resize', () => this.handleResize());
    app.ticker.add((ticker) => this.updateTwinkle(ticker.deltaTime));
  }

  /** Loads a user-supplied photo and displays it full-screen, cover-fit. */
  async setImage(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await createDecodedImageElement(objectUrl);

      this.stopVideo();
      this.clearDeepSkyRefs();
      const sprite = new Sprite(Texture.from(image));
      sprite.anchor.set(0.5);
      coverFit(sprite, this.app.screen.width, this.app.screen.height);
      sprite.tint = grayscaleTint(this.dimmer);

      this.replace(sprite);
      this.currentSprite = sprite;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /** Loads a user-supplied clip and plays it, looped and muted, as a live backdrop. */
  async setVideo(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    const video = createLoopingVideoElement(objectUrl);

    // Distinguishes a genuine corrupt/unsupported file from a harmless
    // autoplay-policy block — video.play() alone can't tell them apart, it
    // rejects the same way for both. Only a real decode failure fires
    // 'error' (with video.error set); confirmed live (Playwright + a
    // garbage file) that without this, a corrupt video silently left the
    // backdrop blank with zero feedback, unlike setImage()'s own
    // image.decode() rejection.
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener('loadeddata', onLoaded);
          video.removeEventListener('error', onError);
        };
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error(video.error?.message || 'صيغة الفيديو غير مدعومة'));
        };
        video.addEventListener('loadeddata', onLoaded);
        video.addEventListener('error', onError);
      });
    } catch (error) {
      // Never tracked in videoObjectUrl at this point — revoke directly here
      // instead of leaving it orphaned (same leak class fixed earlier for
      // the success path).
      URL.revokeObjectURL(objectUrl);
      throw error;
    }

    // Only reached once the file has genuinely decoded — an autoplay-policy
    // rejection here is real but harmless (muted+playsInline avoids it in
    // practice anyway), so it stays silently swallowed.
    await video.play().catch(() => undefined);

    this.stopVideo();
    this.clearDeepSkyRefs();
    this.videoEl = video;
    // Tracked so the *next* stopVideo() call (a later setVideo()/setImage()/
    // setLiveCamera(), or this whole layer never revisiting video again) can
    // revoke it — not revoked here since the <video> element keeps streaming
    // from it for as long as this backdrop is active.
    this.videoObjectUrl = objectUrl;

    const sprite = new Sprite(Texture.from(video));
    sprite.anchor.set(0.5);
    coverFit(sprite, this.app.screen.width, this.app.screen.height);
    sprite.tint = grayscaleTint(this.dimmer);

    this.replace(sprite);
    this.currentSprite = sprite;
  }

  /** Turns on the device's rear camera as a live backdrop (توثيق مباشر) — fireworks render on top of it exactly like any other video background. */
  async setLiveCamera(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });

    const video = createLiveStreamVideoElement(stream);
    await video.play().catch(() => undefined);

    this.stopVideo();
    this.clearDeepSkyRefs();
    this.videoEl = video;
    this.videoStream = stream;

    const sprite = new Sprite(Texture.from(video));
    sprite.anchor.set(0.5);
    coverFit(sprite, this.app.screen.width, this.app.screen.height);
    sprite.tint = grayscaleTint(this.dimmer);

    this.replace(sprite);
    this.currentSprite = sprite;
  }

  /** 0 = fully black night sky, 1 = full brightness of the current backdrop. */
  setDimmer(value: number): void {
    this.dimmer = Math.max(0, Math.min(1, value));
    if (this.currentSprite) this.currentSprite.tint = grayscaleTint(this.dimmer);
  }

  /** Full-screen vertical gradient + ambient horizon glow + twinkling stars. */
  private buildDeepSky(): Container {
    const group = new Container();
    const { width, height } = this.app.screen;

    this.skyGraphics = this.buildSkyGradient(width, height);
    group.addChild(this.skyGraphics);

    this.horizonGraphics = this.buildHorizonGlow(width, height);
    group.addChild(this.horizonGraphics);

    group.addChild(this.buildStars(width, height));

    return group;
  }

  private buildSkyGradient(width: number, height: number): Graphics {
    const gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: SKY_TOP },
        { offset: 1, color: SKY_BOTTOM },
      ],
    });
    this.skyGradient = gradient;

    return new Graphics().rect(0, 0, width, height).fill(gradient);
  }

  private buildHorizonGlow(width: number, height: number): Graphics {
    const glowHeight = Math.max(height * 0.16, 100);

    const gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: `rgba(${HORIZON_GLOW_COLOR}, 0)` },
        { offset: 1, color: `rgba(${HORIZON_GLOW_COLOR}, ${HORIZON_GLOW_PEAK_ALPHA})` },
      ],
    });
    this.horizonGradient = gradient;

    const glow = new Graphics().rect(0, height - glowHeight, width, glowHeight).fill(gradient);
    glow.filters = [new BlurFilter({ strength: 20 })];
    return glow;
  }

  private buildStars(width: number, height: number): Container {
    const container = new Container();
    const count = STAR_MIN_COUNT + Math.floor(Math.random() * (STAR_MAX_COUNT - STAR_MIN_COUNT + 1));
    const stars: TwinkleStar[] = [];

    for (let i = 0; i < count; i++) {
      const fracX = Math.random();
      const fracY = Math.random() * STAR_UPPER_BAND;
      // Visual depth: a star nearer the middle of the screen (fracY close to
      // STAR_UPPER_BAND) reads as "closer" — bigger and brighter — while one
      // nearer the very top (fracY close to 0) reads as "farther" — smaller
      // and dimmer. `depth` in [0, 1] drives both, plus per-star jitter so
      // same-depth stars still vary.
      const depth = fracY / STAR_UPPER_BAND;
      const radius = 0.3 + depth * 1.1 + Math.random() * 0.5;
      const baseAlpha = 0.3 + depth * 0.4 + Math.random() * 0.3;

      const display = new Graphics().circle(fracX * width, fracY * height, radius).fill({ color: STAR_COLOR });
      display.alpha = baseAlpha;
      container.addChild(display);

      stars.push({
        display,
        fracX,
        fracY,
        radius,
        baseAlpha,
        // Staggered speed + starting wave position so stars never blink in unison.
        speed: 0.6 + Math.random() * 1.4,
        wavePos: Math.random() * TWO_PI,
      });
    }

    this.stars = stars;
    return container;
  }

  private updateTwinkle(delta: number): void {
    if (this.stars.length === 0) return;

    for (const star of this.stars) {
      star.wavePos += delta * TWINKLE_SPEED * star.speed;
      if (star.wavePos >= TWO_PI) star.wavePos -= TWO_PI;
      const wave = fastSin(star.wavePos);
      star.display.alpha = star.baseAlpha * (0.55 + 0.45 * wave);
    }
  }

  private handleResize(): void {
    if (this.currentSprite) {
      coverFit(this.currentSprite, this.app.screen.width, this.app.screen.height);
      return;
    }

    // Currently showing the procedural Deep Sky Canvas — redraw every piece
    // in place at the new size instead of destroying and rebuilding the
    // whole thing. Both gradients auto-refit to their shape's new bounds
    // (`textureSpace: 'local'` maps their color stops across whatever rect
    // they're filled into), and every star keeps its own already-rolled
    // look (radius/alpha/speed/wave phase) via its stored fractional
    // position, just redrawn at the new absolute coordinates.
    const { width, height } = this.app.screen;

    if (this.skyGraphics && this.skyGradient) {
      this.skyGraphics.clear().rect(0, 0, width, height).fill(this.skyGradient);
    }

    if (this.horizonGraphics && this.horizonGradient) {
      const glowHeight = Math.max(height * 0.16, 100);
      this.horizonGraphics.clear().rect(0, height - glowHeight, width, glowHeight).fill(this.horizonGradient);
    }

    for (const star of this.stars) {
      star.display.clear().circle(star.fracX * width, star.fracY * height, star.radius).fill({ color: STAR_COLOR });
    }
  }

  private replace(next: Container): void {
    this.parent.addChildAt(next, 0);
    const old = this.current;
    this.parent.removeChild(old);
    old.destroy({ children: true, texture: true, textureSource: true });
    this.current = next;
  }

  /**
   * Drops this instance's own references to the Deep Sky Canvas's
   * persistent Graphics/gradients/stars and destroys the gradients
   * explicitly (a `Graphics.destroy()` from `replace()` doesn't reach a
   * `FillGradient` it was filled with — same reasoning the original
   * `takeTrackedGradients()` step relied on) — called right before
   * replacing the Deep Sky Canvas with a photo/video, so `handleResize()`/
   * `updateTwinkle()` never touch objects that are about to be destroyed.
   * Safe to call when the current backdrop is already a photo/video (every
   * field is already null; destroying a null reference is a no-op).
   */
  private clearDeepSkyRefs(): void {
    this.skyGradient?.destroy();
    this.horizonGradient?.destroy();
    this.stars = [];
    this.skyGraphics = null;
    this.skyGradient = null;
    this.horizonGraphics = null;
    this.horizonGradient = null;
  }

  private stopVideo(): void {
    if (this.videoStream) {
      for (const track of this.videoStream.getTracks()) track.stop();
      this.videoStream = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
      this.videoEl = null;
    }
    // Revokes whatever blob URL the previous setVideo() call created (see
    // videoObjectUrl's own doc comment) — the real fix: without this, every
    // background-video switch orphaned its predecessor's blob URL for the
    // rest of the app session, a genuine cumulative memory leak.
    if (this.videoObjectUrl) {
      URL.revokeObjectURL(this.videoObjectUrl);
      this.videoObjectUrl = null;
    }
  }
}

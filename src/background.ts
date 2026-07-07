import { Application, BlurFilter, Container, FillGradient, Graphics, Sprite, Texture } from 'pixi.js';

export type BackgroundPreset = 'none' | 'city' | 'mountains';

// Deep Sky Canvas palette.
const SKY_TOP = 0x050508; // Royal Black
const SKY_BOTTOM = 0x0f111a; // Deep Midnight Blue
const HORIZON_GLOW_COLOR = '91, 74, 181'; // indigo/violet, as an rgb() triplet for alpha stops
const STAR_MIN_COUNT = 50;
const STAR_MAX_COUNT = 80;
const STAR_UPPER_BAND = 0.8; // stars only scattered across the upper 80% of the screen

interface TwinkleStar {
  display: Graphics;
  baseAlpha: number;
  speed: number;
  phase: number;
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
 * plus the dimmer applied to it. It always sits at stage index 0, safely
 * behind the fireworks and mortar layers added on top of it later.
 *
 * Swapping the backdrop or dimming it never touches per-pixel CPU work:
 * cover-fit is a transform and dimming is a GPU tint multiply, so neither
 * costs frames. The only per-frame cost is the twinkle animation, which is
 * just a handful of `alpha` writes driven by `Math.sin()`.
 */
export class BackgroundLayer {
  private readonly app: Application;
  private current: Container;
  private currentSprite: Sprite | null = null;
  private currentPreset: BackgroundPreset = 'none';
  private videoEl: HTMLVideoElement | null = null;
  private dimmer = 1;

  private stars: TwinkleStar[] = [];
  private twinkleClock = 0;
  private skyGradient: FillGradient | null = null;
  private glowGradient: FillGradient | null = null;

  constructor(app: Application) {
    this.app = app;
    this.current = this.buildDeepSky();
    app.stage.addChildAt(this.current, 0);
    app.renderer.on('resize', () => this.handleResize());
    app.ticker.add((ticker) => this.updateTwinkle(ticker.deltaTime));
  }

  /** Loads a user-supplied photo and displays it full-screen, cover-fit. */
  async setImage(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();

      this.stopVideo();
      this.stars = []; // the old preset's stars are about to be destroyed by replace()
      const oldGradients = this.takeTrackedGradients();
      const sprite = new Sprite(Texture.from(image));
      sprite.anchor.set(0.5);
      coverFit(sprite, this.app.screen.width, this.app.screen.height);
      sprite.tint = grayscaleTint(this.dimmer);

      this.replace(sprite, oldGradients);
      this.currentSprite = sprite;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /** Loads a user-supplied clip and plays it, looped and muted, as a live backdrop. */
  async setVideo(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    await video.play().catch(() => undefined);

    this.stopVideo();
    this.stars = []; // the old preset's stars are about to be destroyed by replace()
    const oldGradients = this.takeTrackedGradients();
    this.videoEl = video;

    const sprite = new Sprite(Texture.from(video));
    sprite.anchor.set(0.5);
    coverFit(sprite, this.app.screen.width, this.app.screen.height);
    sprite.tint = grayscaleTint(this.dimmer);

    this.replace(sprite, oldGradients);
    this.currentSprite = sprite;
    // objectUrl is intentionally not revoked here — the <video> element keeps
    // streaming from it for as long as this backdrop is active.
  }

  /** 0 = fully black night sky, 1 = full brightness of the current backdrop. */
  setDimmer(value: number): void {
    this.dimmer = Math.max(0, Math.min(1, value));
    if (this.currentSprite) this.currentSprite.tint = grayscaleTint(this.dimmer);
  }

  /** Quick built-in backdrops — the Deep Sky Canvas alone, or with a flat skyline/ridge silhouette over it. */
  setPreset(preset: BackgroundPreset): void {
    this.stopVideo();
    this.currentPreset = preset;
    const oldGradients = this.takeTrackedGradients();
    const next = preset === 'none' ? this.buildDeepSky() : this.buildSilhouette(preset);
    this.replace(next, oldGradients);
    this.currentSprite = null;
  }

  /** Full-screen vertical gradient + ambient horizon glow + twinkling stars. */
  private buildDeepSky(): Container {
    const group = new Container();
    const { width, height } = this.app.screen;

    group.addChild(this.buildSkyGradient(width, height));
    group.addChild(this.buildHorizonGlow(width, height));
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
        { offset: 1, color: `rgba(${HORIZON_GLOW_COLOR}, 0.55)` },
      ],
    });
    this.glowGradient = gradient;

    const glow = new Graphics().rect(0, height - glowHeight, width, glowHeight).fill(gradient);
    glow.filters = [new BlurFilter({ strength: 20 })];
    return glow;
  }

  private buildStars(width: number, height: number): Container {
    const container = new Container();
    const count = STAR_MIN_COUNT + Math.floor(Math.random() * (STAR_MAX_COUNT - STAR_MIN_COUNT + 1));
    const stars: TwinkleStar[] = [];

    for (let i = 0; i < count; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height * STAR_UPPER_BAND;
      const radius = 0.4 + Math.random() * 1.3;
      const baseAlpha = 0.35 + Math.random() * 0.5;

      const display = new Graphics().circle(x, y, radius).fill({ color: 0xffffff });
      display.alpha = baseAlpha;
      container.addChild(display);

      stars.push({
        display,
        baseAlpha,
        // Staggered speed + phase so stars never blink in unison.
        speed: 0.6 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.stars = stars;
    return container;
  }

  private updateTwinkle(delta: number): void {
    if (this.stars.length === 0) return;

    this.twinkleClock += delta * 0.02;
    for (const star of this.stars) {
      const wave = Math.sin(this.twinkleClock * star.speed + star.phase);
      star.display.alpha = star.baseAlpha * (0.55 + 0.45 * wave);
    }
  }

  private buildSilhouette(preset: 'city' | 'mountains'): Container {
    const group = this.buildDeepSky();

    const { width, height } = this.app.screen;
    const g = new Graphics();

    if (preset === 'city') {
      let x = 0;
      while (x < width) {
        const w = 30 + Math.random() * 50;
        const h = 60 + Math.random() * 160;
        g.rect(x, height - h, w, h).fill({ color: 0x05050a });
        x += w + 4;
      }
    } else {
      g.moveTo(0, height);
      let x = 0;
      while (x <= width) {
        x += 60;
        g.lineTo(x, height - (80 + Math.random() * 140));
        x += 60;
        g.lineTo(x, height - (20 + Math.random() * 30));
      }
      g.lineTo(width, height);
      g.closePath();
      g.fill({ color: 0x05050a });
    }

    group.addChild(g);
    return group;
  }

  private handleResize(): void {
    if (this.currentSprite) {
      coverFit(this.currentSprite, this.app.screen.width, this.app.screen.height);
      return;
    }

    // Currently showing a procedural preset (Deep Sky ± silhouette) — regenerate
    // it at the new size so the gradient bounds and star field stay correct.
    const oldGradients = this.takeTrackedGradients();
    const next = this.currentPreset === 'none' ? this.buildDeepSky() : this.buildSilhouette(this.currentPreset);
    this.replace(next, oldGradients);
  }

  private replace(next: Container, oldGradients: FillGradient[] = []): void {
    this.app.stage.addChildAt(next, 0);
    const old = this.current;
    this.app.stage.removeChild(old);
    old.destroy({ children: true, texture: true, textureSource: true });
    for (const gradient of oldGradients) gradient.destroy();
    this.current = next;
  }

  /** Captures whichever gradients the *current* (about-to-be-replaced) container owns, so
   * they can be destroyed after the swap — without touching the fresh ones a rebuild just made. */
  private takeTrackedGradients(): FillGradient[] {
    const gradients = [this.skyGradient, this.glowGradient].filter((g): g is FillGradient => g !== null);
    this.skyGradient = null;
    this.glowGradient = null;
    return gradients;
  }

  private stopVideo(): void {
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
      this.videoEl = null;
    }
  }
}

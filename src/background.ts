import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';

export type BackgroundPreset = 'none' | 'city' | 'mountains';

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
 * Owns whatever sits behind the show — the default starfield, an uploaded
 * photo, or a looping video — plus the dimmer applied to it. Swapping the
 * backdrop or dimming it never touches per-pixel CPU work: cover-fit is a
 * transform, and dimming is a GPU tint multiply, so neither costs frames.
 */
export class BackgroundLayer {
  private readonly app: Application;
  private current: Container;
  private currentSprite: Sprite | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private dimmer = 1;

  constructor(app: Application) {
    this.app = app;
    this.current = this.buildStarfield();
    app.stage.addChildAt(this.current, 0);
    app.renderer.on('resize', () => this.handleResize());
  }

  /** Loads a user-supplied photo and displays it full-screen, cover-fit. */
  async setImage(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();

      this.stopVideo();
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
    const video = document.createElement('video');
    video.src = objectUrl;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    await video.play().catch(() => undefined);

    this.stopVideo();
    this.videoEl = video;

    const sprite = new Sprite(Texture.from(video));
    sprite.anchor.set(0.5);
    coverFit(sprite, this.app.screen.width, this.app.screen.height);
    sprite.tint = grayscaleTint(this.dimmer);

    this.replace(sprite);
    this.currentSprite = sprite;
    // objectUrl is intentionally not revoked here — the <video> element keeps
    // streaming from it for as long as this backdrop is active.
  }

  /** 0 = fully black night sky, 1 = full brightness of the current backdrop. */
  setDimmer(value: number): void {
    this.dimmer = Math.max(0, Math.min(1, value));
    if (this.currentSprite) this.currentSprite.tint = grayscaleTint(this.dimmer);
  }

  /** Quick built-in backdrops — a starfield-only sky, or a flat skyline/ridge silhouette over it. */
  setPreset(preset: BackgroundPreset): void {
    this.stopVideo();
    const next = preset === 'none' ? this.buildStarfield() : this.buildSilhouette(preset);
    this.replace(next);
    this.currentSprite = null;
  }

  private buildSilhouette(preset: 'city' | 'mountains'): Container {
    const group = new Container();
    group.addChild(this.buildStarfield());

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

  private buildStarfield(): Container {
    const stars = new Container();
    const graphics = new Graphics();
    const count = 140;

    for (let i = 0; i < count; i++) {
      const x = Math.random() * this.app.screen.width;
      const y = Math.random() * this.app.screen.height * 0.75;
      const r = Math.random() * 1.2 + 0.3;
      graphics.circle(x, y, r).fill({ color: 0xffffff, alpha: 0.3 + Math.random() * 0.5 });
    }

    stars.addChild(graphics);
    return stars;
  }

  private handleResize(): void {
    if (this.currentSprite) {
      coverFit(this.currentSprite, this.app.screen.width, this.app.screen.height);
    }
  }

  private replace(next: Container): void {
    this.app.stage.addChildAt(next, 0);
    const old = this.current;
    this.app.stage.removeChild(old);
    old.destroy({ children: true, texture: true, textureSource: true });
    this.current = next;
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

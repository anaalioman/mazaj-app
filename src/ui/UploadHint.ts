import { Application, Container, Graphics, Text, TextStyle, type Ticker } from 'pixi.js';
import { BackdropBlurFilter, DropShadowFilter } from 'pixi-filters';
import type { SliderSheetPanel } from './PlanningSubpanels';
import { tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';

const STORAGE_KEY = 'mzj-upload-hint-shown';
const VISIBLE_MS = 3000;

const MESSAGES = {
  image: 'تحكم بوهج الإضاءة عبر شريط التحكم للحفاظ على جودة الصورة.',
  video: 'تحكم بوهج الإضاءة عبر شريط التحكم للحفاظ على جودة وتفاصيل الفيديو.',
};

/**
 * Geometry ported 1:1 from the old `.mzj-upload-hint` CSS: a glass pill
 * pinned to `top: 70px`, centered horizontally, `max-width: min(360px,
 * 88vw)`, fading in with an 8px upward slide (`opacity 0.35s ease,
 * transform 0.35s ease`). `BackdropBlurFilter` (the same real
 * backdrop-blur technique HeaderBar's own glass pills use) replaces the old
 * `backdrop-filter: blur(10px) saturate(180%)`; `DropShadowFilter` replaces
 * `box-shadow: 0 12px 30px rgba(0,0,0,0.4)`.
 */
const TOAST_TOP_Y = 70;
const TOAST_MAX_WIDTH = 360;
const TOAST_MAX_WIDTH_RATIO = 0.88;
const TOAST_PADDING_X = 18;
const TOAST_PADDING_Y = 10;
const TOAST_FONT_SIZE = 13;
const TOAST_LINE_HEIGHT = 19;
const TOAST_SLIDE_Y = 8;
/** Matches the old `transition: opacity 0.35s ease, transform 0.35s ease`. */
const TOAST_FADE_MS = 350;

/**
 * A one-time floating hint, shown for 3s the first time the player uploads a
 * background image or video, pointing them toward the fireworks-glow slider
 * (via a brief highlight pulse on that panel's own edge, see
 * BottomSheetPanel.pulse()) so the glow doesn't wash out their photo/video.
 * Never shown again after the first time (localStorage), on this or any
 * future upload. Fully Pixi now — no DOM/CSS at all; see the class doc
 * comment on the geometry constants above for the 1:1 port from the old
 * `.mzj-upload-hint`/`.mzj-upload-hint-visible` rules.
 */
export class UploadHint {
  private readonly app: Application;
  private readonly glowPanel: SliderSheetPanel;
  private readonly toastRoot: Container;
  private readonly toastBg: Graphics;
  private readonly toastText: Text;
  private hideTimer: TickerTimerHandle | null = null;
  /** -TOAST_SLIDE_Y when hidden, 0 when fully shown — animated independently of `toastRoot.alpha` but combined with it every frame in applyTransform(). */
  private slideOffset = -TOAST_SLIDE_Y;
  private lastMessage = '';

  constructor(app: Application, uiContainer: Container, glowPanel: SliderSheetPanel) {
    this.app = app;
    this.glowPanel = glowPanel;

    this.toastRoot = new Container();
    this.toastRoot.alpha = 0;
    this.toastRoot.eventMode = 'none';
    uiContainer.addChild(this.toastRoot);

    this.toastBg = new Graphics();
    this.toastBg.filters = [
      new BackdropBlurFilter({ strength: 10, quality: 4 }),
      new DropShadowFilter({ color: 0x000000, alpha: 0.4, blur: 12, offset: { x: 0, y: 6 } }),
    ];
    this.toastRoot.addChild(this.toastBg);

    this.toastText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: TOAST_FONT_SIZE,
        lineHeight: TOAST_LINE_HEIGHT,
        fill: 0xffffff,
        align: 'center',
        wordWrap: true,
      }),
    });
    this.toastText.anchor.set(0.5, 0);
    this.toastRoot.addChild(this.toastText);

    app.renderer.on('resize', () => {
      if (this.lastMessage) this.layoutToast(this.lastMessage);
    });
  }

  show(kind: keyof typeof MESSAGES): void {
    if (this.hasShownBefore()) return;

    this.layoutToast(`✨ ${MESSAGES[kind]}`);
    this.animateToast(true);
    this.glowPanel.pulse();

    if (this.hideTimer !== null) this.hideTimer.cancel();
    this.hideTimer = tickerSetTimeout(this.app.ticker, () => this.animateToast(false), VISIBLE_MS);

    this.markShown();
  }

  private layoutToast(message: string): void {
    this.lastMessage = message;
    const screen = this.app.screen;
    const maxWidth = Math.min(TOAST_MAX_WIDTH, screen.width * TOAST_MAX_WIDTH_RATIO);

    this.toastText.style.wordWrapWidth = maxWidth - TOAST_PADDING_X * 2;
    this.toastText.text = message;

    const pillWidth = Math.min(maxWidth, this.toastText.width + TOAST_PADDING_X * 2);
    const pillHeight = this.toastText.height + TOAST_PADDING_Y * 2;
    const radius = pillHeight / 2;

    this.toastBg
      .clear()
      .roundRect(-pillWidth / 2, 0, pillWidth, pillHeight, radius)
      .fill({ color: 0x0a0c14, alpha: 0.88 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.14 });
    this.toastText.position.set(0, TOAST_PADDING_Y);

    this.toastRoot.position.set(screen.width / 2, TOAST_TOP_Y + this.slideOffset);
  }

  private animateToast(visible: boolean): void {
    const targetAlpha = visible ? 1 : 0;
    const targetOffset = visible ? 0 : -TOAST_SLIDE_Y;
    const startAlpha = this.toastRoot.alpha;
    const startOffset = this.slideOffset;
    if (startAlpha === targetAlpha && startOffset === targetOffset) return;

    let elapsedMs = 0;
    const step = (t: Ticker): void => {
      elapsedMs += t.deltaMS;
      const progress = Math.min(1, elapsedMs / TOAST_FADE_MS);
      this.toastRoot.alpha = startAlpha + (targetAlpha - startAlpha) * progress;
      this.slideOffset = startOffset + (targetOffset - startOffset) * progress;
      this.toastRoot.position.set(this.app.screen.width / 2, TOAST_TOP_Y + this.slideOffset);
      if (progress >= 1) this.app.ticker.remove(step);
    };
    this.app.ticker.add(step);
  }

  private hasShownBefore(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false; // localStorage unavailable — just show it rather than crash
    }
  }

  private markShown(): void {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // best-effort only
    }
  }
}

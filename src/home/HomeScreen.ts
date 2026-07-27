import {
  Application,
  Container,
  FillGradient,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from 'pixi.js';
import { iconTexture } from '../ui/svgIconTexture';
import type { IconName } from '../ui/icons';

export type MoodId =
  | 'fireworks'
  | 'colorMix'
  | 'shake'
  | 'glassStones'
  | 'ripples'
  | 'pendulum'
  | 'colorPour';

interface MoodCard {
  id: MoodId;
  icon: IconName;
  title: string;
  description: string;
  active: boolean;
}

// Priority order from the product roadmap. Only "fireworks" is built so
// far; the rest render as locked "قريبًا" cards so the hub reads as a
// complete, growing product from day one.
const MOODS: MoodCard[] = [
  { id: 'fireworks', icon: 'fireworksMood', title: 'الألعاب النارية', description: 'اصنع عرضًا مبهرًا من الألعاب النارية', active: true },
  { id: 'colorMix', icon: 'palette', title: 'خلط الألوان', description: 'امزج الألوان بإصبعك كأنها سوائل', active: false },
  { id: 'shake', icon: 'vibrate', title: 'الهزّة', description: 'هزّ الشاشة ومازج الألوان على الحواف', active: false },
  { id: 'glassStones', icon: 'gem', title: 'أحجار الزجاج', description: 'حرّك أحجارًا ملوّنة بفيزياء تصادم حقيقية', active: false },
  { id: 'ripples', icon: 'waves', title: 'التموّجات', description: 'المس الماء واصنع تموّجات حقيقية', active: false },
  { id: 'pendulum', icon: 'pendulum', title: 'لوحة البندول', description: 'ارسم منحنيات ساحرة بفيزياء البندول', active: false },
  { id: 'colorPour', icon: 'droplet', title: 'Color Pour', description: 'اسكب الألوان وأمِل جهازك', active: false },
];

export interface HomeScreenDeps {
  onSelect: (mood: MoodId) => void;
}

/**
 * Geometry ported 1:1 from the old `#home-screen`/`.mzj-home-*`/`.mzj-mood-*`
 * CSS (measured directly off a live render) before deleting it — a
 * responsive card grid (3 columns ≥640px, 2 columns narrower, matching the
 * old `@media (max-width: 640px)` breakpoint exactly), each row's height
 * matching the tallest card in that row (CSS Grid's own default implicit
 * row-sizing behavior, replicated here by measuring every card's own wrapped
 * text height first, then taking the max per row).
 */
const PADDING_X = 20;
const PADDING_TOP = 40;
const INNER_MAX_WIDTH = 760;
const NARROW_BREAKPOINT = 640;
const TITLE_FONT_SIZE_WIDE = 56;
const TITLE_FONT_SIZE_NARROW = 42;
const TITLE_SUBTITLE_GAP = 6;
const SUBTITLE_FONT_SIZE = 16;
const SUBTITLE_GRID_GAP = 36;
const GRID_GAP = 16;

const CARD_PADDING_TOP = 26;
const CARD_PADDING_X = 14;
const CARD_PADDING_BOTTOM = 20;
const CARD_RADIUS = 18;
const ICON_BOX = 56;
const ICON_RADIUS = 16;
/** The old flex column's `gap: 8px` between every child, plus the icon's own `margin-bottom: 2px`. */
const ICON_TITLE_GAP = 10;
const TITLE_DESC_GAP = 8;
const CARD_TITLE_FONT_SIZE = 15;
const CARD_DESC_FONT_SIZE = 12;
const CARD_DESC_LINE_HEIGHT = 17;
const BADGE_INSET = 10;
const BADGE_PADDING_X = 8;
const BADGE_HEIGHT = 19;
const ICON_SOURCE_SIZE = 44;

const GOLD = 0xffcf6b;
const CARD_TITLE_COLOR = 0xffe9b3;
const CARD_DESC_COLOR = 0xffffff;
const CARD_DESC_ALPHA = 0.55;
const LOCKED_ALPHA = 0.5;

/** A vertical drag past this many px counts as a scroll, not a card tap — same reasoning as every other tap-vs-drag disambiguation in this app (see utils/swipeGesture.ts). */
const DRAG_THRESHOLD_PX = 8;

interface Card {
  id: MoodId;
  active: boolean;
  root: Container;
  bg: Graphics;
  iconBg: Graphics;
  iconSprite: Sprite;
  titleText: Text;
  descText: Text;
  contentHeight: number;
  badge?: { root: Container; bg: Graphics; text: Text };
}

/** Deliberately unsaturated near-black — the shared Application's background color is set to this whenever the home screen is the active screen, see main.ts. */
export const HOME_BACKGROUND = '#050508';

/** The single entry hub every mood is launched from — same visual identity across the whole app. Fully Pixi, mounted as a Container on the one shared Application (see main.ts) — no HTML/CSS at all; see PROGRESS.md. */
export class HomeScreen {
  readonly app: Application;
  private readonly deps: HomeScreenDeps;
  private readonly titleText: Text;
  /** Built once — layout() only ever mutates its `fontSize` on resize (Pixi's `TextStyle` propagates the change to `titleText` on its own), instead of a fresh `FillGradient`/`TextStyle` pair being allocated every resize call. */
  private readonly titleTextStyle: TextStyle;
  private readonly subtitleText: Text;
  private readonly cards: Card[] = [];
  /** Everything that scrolls (title, subtitle, every card) — `layer` itself (main.ts's own show/hide handle) never moves; only this inner container's own `.y` does. */
  private readonly content: Container;
  /** A full-screen invisible hit surface behind `content`, catching drag-starts that land on empty space (the gaps between cards, or below the last row) — cards themselves still hit-test first for their own taps, since they're drawn on top (see buildCard()'s own added-after-this ordering). */
  private readonly dragSurface: Container;
  private scrollY = 0;
  private minScrollY = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartScrollY = 0;
  /** True once the current gesture has moved past DRAG_THRESHOLD_PX — checked by every card's own pointertap so a scroll can never also fire deps.onSelect(). */
  private dragMoved = false;

  private constructor(app: Application, layer: Container, deps: HomeScreenDeps) {
    this.app = app;
    this.deps = deps;

    this.dragSurface = new Container();
    this.dragSurface.eventMode = 'static';
    this.dragSurface.on('pointerdown', (event: FederatedPointerEvent) => this.handleDragStart(event));
    layer.addChild(this.dragSurface);

    this.content = new Container();
    layer.addChild(this.content);

    // Ported from the old `background: linear-gradient(180deg, #ffe9b3, #ff9f45); -webkit-background-clip: text` — a real Pixi FillGradient on the text itself, not a flat color.
    const titleGradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: 0xffe9b3 },
        { offset: 1, color: 0xff9f45 },
      ],
    });
    this.titleTextStyle = new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize: TITLE_FONT_SIZE_WIDE,
      fontWeight: '800',
      fill: titleGradient,
      dropShadow: { color: 0xff9f45, alpha: 0.25, blur: 24, distance: 2 },
    });
    this.titleText = new Text({
      text: 'مزاج',
      style: this.titleTextStyle,
    });
    this.titleText.anchor.set(0.5, 0);
    this.content.addChild(this.titleText);

    this.subtitleText = new Text({
      text: 'اختر مزاجك',
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: SUBTITLE_FONT_SIZE, fill: 0xffffff }),
    });
    this.subtitleText.alpha = 0.6;
    this.subtitleText.anchor.set(0.5, 0);
    this.content.addChild(this.subtitleText);

    for (const mood of MOODS) {
      const card = this.buildCard(this.content, mood);
      this.cards.push(card);
    }

    // Global drag tracking — same convention as every other draggable
    // control in this app (PixiSlider, PlanningMode, TextComposer's resize
    // handles): pointerdown starts locally (dragSurface or a card's own
    // root, see buildCard()), pointermove/pointerup are tracked on
    // app.stage so a fast finger sliding off the original target never
    // drops the gesture.
    app.stage.on('pointermove', (event: FederatedPointerEvent) => this.handleDragMove(event));
    app.stage.on('pointerup', (event: FederatedPointerEvent) => this.handleDragEnd(event));
    app.stage.on('pointerupoutside', (event: FederatedPointerEvent) => this.handleDragEnd(event));

    app.renderer.on('resize', () => this.layout());
    this.layout();
  }

  /** `layer` is a Container main.ts already added to the shared app.stage, toggled visible/hidden alongside every other screen — this class never creates its own Application or canvas. */
  static create(app: Application, layer: Container, deps: HomeScreenDeps): HomeScreen {
    return new HomeScreen(app, layer, deps);
  }

  /**
   * One mood card: a glass rounded-rect background, a tinted icon tile,
   * title, description, and — for locked moods — a "قريبًا" badge pinned to
   * the card's top-left (RTL's `inset-inline-end`). Only `mood.active` cards
   * are interactive; locked ones are visually dimmed and never claim a
   * hitArea at all.
   */
  private buildCard(layer: Container, mood: MoodCard): Card {
    const root = new Container();
    root.alpha = mood.active ? 1 : LOCKED_ALPHA;
    if (mood.active) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      // A second, independent listener on this same target — Pixi's
      // stopPropagation() (called by the listener below) only blocks
      // bubbling to *ancestors*, never other listeners on the exact same
      // object, so this still fires and lets a drag starting on a card
      // itself be tracked exactly like one starting on empty space (see
      // dragSurface's own doc comment).
      root.on('pointerdown', (event: FederatedPointerEvent) => this.handleDragStart(event));
      root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
      root.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        // A scroll drag must never also open a mood — see dragMoved's own doc comment.
        if (this.dragMoved) return;
        this.deps.onSelect(mood.id);
      });
    }
    layer.addChild(root);

    const bg = new Graphics();
    root.addChild(bg);

    const iconBg = new Graphics();
    root.addChild(iconBg);

    const iconSprite = new Sprite();
    iconSprite.anchor.set(0.5);
    iconSprite.tint = mood.active ? GOLD : 0xffffff;
    iconSprite.alpha = mood.active ? 1 : 0.45;
    iconSprite.width = 26;
    iconSprite.height = 26;
    root.addChild(iconSprite);
    void iconTexture(mood.icon, ICON_SOURCE_SIZE, '#ffffff')
      .then((texture) => {
        iconSprite.texture = texture;
      })
      .catch((error: unknown) => {
        console.error(`Failed to load home mood icon: ${mood.icon}`, error);
      });

    const titleText = new Text({
      text: mood.title,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: CARD_TITLE_FONT_SIZE,
        fontWeight: '700',
        fill: CARD_TITLE_COLOR,
        align: 'center',
        // Required for layout()'s own `wordWrapWidth` assignment to have any
        // effect at all — PixiJS ignores wordWrapWidth entirely unless
        // wordWrap is explicitly true (confirmed against pixi.js's own
        // TextStyle/CanvasTextMetrics source). Without this, a long mood
        // title (e.g. "أحجار الزجاج") could overflow the card's own bounds
        // on a narrow 2-column layout instead of wrapping onto a second line.
        wordWrap: true,
      }),
    });
    titleText.anchor.set(0.5, 0);
    root.addChild(titleText);

    const descText = new Text({
      text: mood.description,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: CARD_DESC_FONT_SIZE,
        fill: CARD_DESC_COLOR,
        align: 'center',
        wordWrap: true,
        lineHeight: CARD_DESC_LINE_HEIGHT,
      }),
    });
    descText.alpha = CARD_DESC_ALPHA;
    descText.anchor.set(0.5, 0);
    root.addChild(descText);

    let badge: { root: Container; bg: Graphics; text: Text } | undefined;
    if (!mood.active) {
      const badgeRoot = new Container();
      const badgeBg = new Graphics();
      badgeRoot.addChild(badgeBg);
      const badgeText = new Text({
        text: 'قريبًا',
        style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: 10, fontWeight: '700', fill: 0xffffff }),
      });
      badgeText.alpha = 0.75;
      badgeText.anchor.set(0.5);
      badgeRoot.addChild(badgeText);
      root.addChild(badgeRoot);
      badge = { root: badgeRoot, bg: badgeBg, text: badgeText };
    }

    return { id: mood.id, active: mood.active, root, bg, iconBg, iconSprite, titleText, descText, contentHeight: 0, badge };
  }

  /** Recomputes everything from the current screen size — columns, card width, per-row heights (matching CSS Grid's own implicit row-sizing: every card in a row shares the tallest card's height). Called once at construction and again on every resize. */
  private layout(): void {
    const screen = this.app.screen;
    this.dragSurface.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    const innerWidth = Math.min(INNER_MAX_WIDTH, screen.width - PADDING_X * 2);
    const innerX = (screen.width - innerWidth) / 2;
    const columns = screen.width >= NARROW_BREAKPOINT ? 3 : 2;
    const titleFontSize = screen.width >= NARROW_BREAKPOINT ? TITLE_FONT_SIZE_WIDE : TITLE_FONT_SIZE_NARROW;

    this.titleTextStyle.fontSize = titleFontSize;
    this.titleText.position.set(screen.width / 2, PADDING_TOP);
    this.subtitleText.position.set(screen.width / 2, PADDING_TOP + this.titleText.height + TITLE_SUBTITLE_GAP);

    const gridTop = this.subtitleText.y + this.subtitleText.height + SUBTITLE_GRID_GAP;
    const cardWidth = (innerWidth - GRID_GAP * (columns - 1)) / columns;
    const descWrapWidth = cardWidth - CARD_PADDING_X * 2;

    // Pass 1: lay out text (wordWrap depends on cardWidth) and measure each
    // card's own natural content height.
    for (const card of this.cards) {
      card.descText.style.wordWrapWidth = descWrapWidth;
      card.titleText.style.wordWrapWidth = cardWidth - CARD_PADDING_X * 2;
      card.contentHeight =
        CARD_PADDING_TOP + ICON_BOX + ICON_TITLE_GAP + card.titleText.height + TITLE_DESC_GAP + card.descText.height + CARD_PADDING_BOTTOM;
    }

    // Pass 2: row-by-row, take the max content height (CSS Grid's implicit
    // row track sizing) and position every card in that row identically —
    // plain indexed loops instead of slice()/map()/spread, so laying out the
    // grid on resize allocates no temporary arrays at all.
    let rowTop = gridTop;
    let contentBottom = gridTop;
    for (let start = 0; start < this.cards.length; start += columns) {
      const rowEnd = Math.min(start + columns, this.cards.length);

      let rowHeight = 0;
      for (let i = start; i < rowEnd; i++) {
        if (this.cards[i].contentHeight > rowHeight) rowHeight = this.cards[i].contentHeight;
      }

      for (let i = start; i < rowEnd; i++) {
        const indexInRow = i - start;
        // RTL: first card in the row lands at the row's right edge.
        const cardX = innerX + innerWidth - (indexInRow + 1) * cardWidth - indexInRow * GRID_GAP;
        this.positionCard(this.cards[i], cardX, rowTop, cardWidth, rowHeight);
      }

      contentBottom = rowTop + rowHeight;
      rowTop = contentBottom + GRID_GAP;
    }

    // Real vertical scrolling: content shorter than the screen simply pins
    // at y=0 (minScrollY collapses to 0 too, so the drag clamp below already
    // disables any effective movement — no separate special-case needed).
    this.minScrollY = Math.min(0, screen.height - contentBottom);
    this.scrollY = Math.max(this.minScrollY, Math.min(0, this.scrollY));
    this.content.y = this.scrollY;
  }

  private handleDragStart(event: FederatedPointerEvent): void {
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.global.y;
    this.dragStartScrollY = this.scrollY;
    this.dragMoved = false;
  }

  private handleDragMove(event: FederatedPointerEvent): void {
    if (this.dragPointerId === null || event.pointerId !== this.dragPointerId) return;
    const dy = event.global.y - this.dragStartY;
    if (!this.dragMoved && Math.abs(dy) >= DRAG_THRESHOLD_PX) this.dragMoved = true;
    if (!this.dragMoved) return;
    this.scrollY = Math.max(this.minScrollY, Math.min(0, this.dragStartScrollY + dy));
    this.content.y = this.scrollY;
  }

  private handleDragEnd(event: FederatedPointerEvent): void {
    if (this.dragPointerId === null || event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
  }

  private positionCard(card: Card, x: number, y: number, width: number, height: number): void {
    card.root.position.set(x, y);
    card.root.hitArea = new Rectangle(0, 0, width, height);

    card.bg
      .clear()
      .roundRect(0, 0, width, height, CARD_RADIUS)
      .fill({ color: 0x0f172a, alpha: 0.45 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.14 });

    const centerX = width / 2;
    const iconTop = CARD_PADDING_TOP;
    card.iconBg
      .clear()
      .roundRect(centerX - ICON_BOX / 2, iconTop, ICON_BOX, ICON_BOX, ICON_RADIUS)
      .fill({ color: card.active ? 0xffe9b3 : 0xffffff, alpha: card.active ? 0.14 : 0.06 });
    card.iconSprite.position.set(centerX, iconTop + ICON_BOX / 2);

    const titleTop = iconTop + ICON_BOX + ICON_TITLE_GAP;
    card.titleText.position.set(centerX, titleTop);

    const descTop = titleTop + card.titleText.height + TITLE_DESC_GAP;
    card.descText.position.set(centerX, descTop);

    const badge = card.badge;
    if (badge) {
      const badgeWidth = badge.text.width + BADGE_PADDING_X * 2;
      // RTL `inset-inline-end: 10px` = the card's left edge.
      badge.root.position.set(BADGE_INSET, BADGE_INSET);
      badge.bg
        .clear()
        .roundRect(0, 0, badgeWidth, BADGE_HEIGHT, BADGE_HEIGHT / 2)
        .fill({ color: 0xffffff, alpha: 0.1 })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.18 });
      badge.text.position.set(badgeWidth / 2, BADGE_HEIGHT / 2);
    }
  }
}

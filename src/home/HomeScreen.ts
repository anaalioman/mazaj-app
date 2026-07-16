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
import { BackdropBlurFilter } from 'pixi-filters';
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
  private readonly subtitleText: Text;
  private readonly cards: Card[] = [];

  private constructor(app: Application, layer: Container, deps: HomeScreenDeps) {
    this.app = app;
    this.deps = deps;

    this.titleText = new Text({
      text: 'مزاج',
      style: this.titleStyle(TITLE_FONT_SIZE_WIDE),
    });
    this.titleText.anchor.set(0.5, 0);
    layer.addChild(this.titleText);

    this.subtitleText = new Text({
      text: 'اختر مزاجك',
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: SUBTITLE_FONT_SIZE, fill: 0xffffff }),
    });
    this.subtitleText.alpha = 0.6;
    this.subtitleText.anchor.set(0.5, 0);
    layer.addChild(this.subtitleText);

    for (const mood of MOODS) {
      const card = this.buildCard(layer, mood);
      this.cards.push(card);
    }

    app.renderer.on('resize', () => this.layout());
    this.layout();
  }

  /** `layer` is a Container main.ts already added to the shared app.stage, toggled visible/hidden alongside every other screen — this class never creates its own Application or canvas. */
  static create(app: Application, layer: Container, deps: HomeScreenDeps): HomeScreen {
    return new HomeScreen(app, layer, deps);
  }

  private titleStyle(fontSize: number): TextStyle {
    // Ported from the old `background: linear-gradient(180deg, #ffe9b3, #ff9f45); -webkit-background-clip: text` — a real Pixi FillGradient on the text itself, not a flat color.
    const gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: 0xffe9b3 },
        { offset: 1, color: 0xff9f45 },
      ],
    });
    return new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize,
      fontWeight: '800',
      fill: gradient,
      dropShadow: { color: 0xff9f45, alpha: 0.25, blur: 24, distance: 2 },
    });
  }

  /**
   * One mood card: a glass rounded-rect background (`BackdropBlurFilter`,
   * the same real backdrop-blur technique HeaderBar's pills use), a tinted
   * icon tile, title, description, and — for locked moods — a "قريبًا"
   * badge pinned to the card's top-left (RTL's `inset-inline-end`). Only
   * `mood.active` cards are interactive; locked ones are visually dimmed
   * and never claim a hitArea at all.
   */
  private buildCard(layer: Container, mood: MoodCard): Card {
    const root = new Container();
    root.alpha = mood.active ? 1 : LOCKED_ALPHA;
    if (mood.active) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
      root.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        this.deps.onSelect(mood.id);
      });
    }
    layer.addChild(root);

    const bg = new Graphics();
    bg.filters = [new BackdropBlurFilter({ strength: 8, quality: 4 })];
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
    void iconTexture(mood.icon, ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      iconSprite.texture = texture;
    });

    const titleText = new Text({
      text: mood.title,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: CARD_TITLE_FONT_SIZE,
        fontWeight: '700',
        fill: CARD_TITLE_COLOR,
        align: 'center',
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
    const innerWidth = Math.min(INNER_MAX_WIDTH, screen.width - PADDING_X * 2);
    const innerX = (screen.width - innerWidth) / 2;
    const columns = screen.width >= NARROW_BREAKPOINT ? 3 : 2;
    const titleFontSize = screen.width >= NARROW_BREAKPOINT ? TITLE_FONT_SIZE_WIDE : TITLE_FONT_SIZE_NARROW;

    this.titleText.style = this.titleStyle(titleFontSize);
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
    // row track sizing) and position every card in that row identically.
    let rowTop = gridTop;
    for (let start = 0; start < this.cards.length; start += columns) {
      const row = this.cards.slice(start, start + columns);
      const rowHeight = Math.max(...row.map((c) => c.contentHeight));

      row.forEach((card, indexInRow) => {
        // RTL: first card in the array lands at the row's right edge.
        const cardX = innerX + innerWidth - (indexInRow + 1) * cardWidth - indexInRow * GRID_GAP;
        this.positionCard(card, cardX, rowTop, cardWidth, rowHeight);
      });

      rowTop += rowHeight + GRID_GAP;
    }
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

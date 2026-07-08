import { icon, type IconName } from '../ui/icons';

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

/** The single entry hub every mood is launched from — same visual identity across the whole app. */
export class HomeScreen {
  constructor(root: HTMLDivElement, deps: HomeScreenDeps) {
    root.innerHTML = HomeScreen.template();

    for (const mood of MOODS) {
      if (!mood.active) continue;
      const card = root.querySelector<HTMLButtonElement>(`.mzj-mood-card[data-mood="${mood.id}"]`)!;
      card.addEventListener('click', () => deps.onSelect(mood.id));
    }
  }

  private static template(): string {
    return `
      <div class="mzj-home-inner">
        <h1 class="mzj-home-title">مزاج</h1>
        <p class="mzj-home-subtitle">اختر مزاجك</p>
        <div class="mzj-mood-grid">
          ${MOODS.map((mood) => HomeScreen.cardTemplate(mood)).join('')}
        </div>
      </div>
    `;
  }

  private static cardTemplate(mood: MoodCard): string {
    const lockedClass = mood.active ? '' : ' mzj-mood-locked';
    const disabledAttr = mood.active ? '' : 'disabled';
    const badge = mood.active ? '' : '<span class="mzj-mood-badge">قريبًا</span>';

    return `
      <button type="button" class="mzj-mood-card${lockedClass}" data-mood="${mood.id}" ${disabledAttr}>
        <span class="mzj-mood-icon">${icon(mood.icon, 30)}</span>
        <span class="mzj-mood-title">${mood.title}</span>
        <span class="mzj-mood-desc">${mood.description}</span>
        ${badge}
      </button>
    `;
  }
}

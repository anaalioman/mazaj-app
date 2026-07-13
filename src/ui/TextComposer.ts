import { Application, Graphics, Text, TextStyle } from 'pixi.js';
import { icon } from './icons';
import { TextReveal, type TextRevealEffect } from '../effects/TextReveal';
import { TEXT_EFFECTS } from '../effects/textEffects/registry';

export type { TextRevealEffect };

export interface TextRevealConfig {
  text: string;
  effect: TextRevealEffect;
  x: number;
  y: number;
  fontScale: number;
}

export interface TextComposerDeps {
  app: Application;
  /** True while the input+effects bar OR the control box is open — lets the caller hide whatever else is on screen (e.g. the planning screen's own icon columns) so this stays the sole focus. */
  onComposingChange: (composing: boolean) => void;
}

const SAMPLE_PHRASE = 'مبروك';
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
/** Effects bar order/labels come straight from the registry — add an effect there and it shows up here automatically, no other change needed. */
const PREVIEW_ORDER: TextRevealEffect[] = TEXT_EFFECTS.map((entry) => entry.id);
/** Fixed demo word for every effects-bar preview — unrelated to the player's own text/the input's pre-filled default. */
const PREVIEW_PHRASE = 'مرحبا';
const PREVIEW_HOLD_BEFORE_MS = 600;
const PREVIEW_HOLD_AFTER_MS = 600;
const PREVIEW_NONE_HOLD_MS = 2000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Free-text composing flow for the "T" icon: a live top input + an effects
 * bar (each icon auto-loops its own demo continuously — no tap needed to
 * preview, a tap only confirms that effect), a back arrow that closes all of
 * that and reveals the player's real text in a draggable + pinch-resizable
 * control box, and tapping outside commits it (bare text, no chrome) at
 * whatever position/scale was left. Tapping the committed text later
 * reopens this whole flow pre-filled. Position/scale persist in memory for
 * as long as the mood instance lives (see fireworksMood.ts's module doc).
 *
 * Two separate DOM roots because exactly one of them is ever visible at a
 * time: `root` (top input + effects bar) while composing text, and
 * `controlBoxRoot` (a full-screen backdrop containing the drag/pinch box)
 * once the back arrow closes that — they can't be nested inside each other.
 *
 * The effects bar's demo previews reuse the exact same TextReveal engine as
 * the real final reveal (same particle physics, no CSS/static-image
 * stand-in) via a dedicated instance, cycling through smoke/flame/none one
 * at a time (never more than one running at once) for as long as the input
 * row is open.
 */
export class TextComposer {
  readonly root: HTMLDivElement;
  readonly controlBoxRoot: HTMLDivElement;
  private readonly deps: TextComposerDeps;
  private readonly previewText: Text;
  private readonly baseFontSize: number;
  private readonly previewReveal: TextReveal;
  /** Clips the preview reveal's text+particles to the current icon slot's rectangle — nothing may render outside it, however the particles naturally move. */
  private readonly previewMask: Graphics;

  private text = SAMPLE_PHRASE;
  private effect: TextRevealEffect = 'none';
  private posX: number;
  private posY: number;
  private scale = 1;
  private hasCommittedOnce = false;

  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number } | null = null;
  private pinchStartDist: number | null = null;
  private pinchStartScale = 1;

  private previewCycleActive = false;
  private previewGeneration = 0;
  private previewIndex = 0;
  private previewCycleTimer: number | undefined;

  constructor(deps: TextComposerDeps) {
    this.deps = deps;

    const { width, height } = deps.app.screen;
    this.posX = width / 2;
    this.posY = height / 2;
    this.baseFontSize = Math.max(36, Math.min(width, height) * 0.09);

    this.previewReveal = new TextReveal(deps.app);
    deps.app.ticker.add((ticker) => this.previewReveal.update(ticker.deltaTime));

    // Not added to the stage — Graphics used purely as a mask don't need to
    // be part of the render tree, only assigned via `.mask`.
    this.previewMask = new Graphics();
    this.previewReveal.container.mask = this.previewMask;

    this.previewText = new Text({ text: this.text, style: this.textStyle() });
    this.previewText.anchor.set(0.5);
    this.previewText.visible = false;
    this.previewText.eventMode = 'static';
    this.previewText.cursor = 'pointer';
    this.previewText.on('pointerdown', (event) => {
      event.stopPropagation();
      this.open();
    });
    deps.app.stage.addChild(this.previewText);
    this.syncPreviewTransform();

    this.root = document.createElement('div');
    this.root.id = 'mzj-text-composer';
    this.root.className = 'mzj-hidden';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);

    this.controlBoxRoot = document.createElement('div');
    this.controlBoxRoot.id = 'mzj-text-control-backdrop';
    this.controlBoxRoot.className = 'mzj-hidden';
    this.controlBoxRoot.innerHTML = `<div id="mzj-text-control-box"></div>`;
    document.body.appendChild(this.controlBoxRoot);

    for (const root of [this.root, this.controlBoxRoot]) {
      for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
        root.addEventListener(type, (event) => event.stopPropagation());
      }
    }

    this.wireInput();
    this.wireEffectButtons();
    this.wireBack();
    this.wireControlBox();
  }

  /** Opens the composer pre-filled with whatever text/effect is currently set — used by the T icon and by tapping the committed text. */
  open(): void {
    this.closeControlBox();
    this.previewText.visible = false;
    this.query<HTMLInputElement>('#mzj-text-composer-input').value = this.text;
    this.syncEffectButtons();
    this.root.classList.remove('mzj-hidden');
    this.deps.onComposingChange(true);
    window.setTimeout(() => this.query<HTMLInputElement>('#mzj-text-composer-input').focus(), 50);
    this.startPreviewCycle();
  }

  /**
   * Returns the config beginShow() should reveal with, and hides the static
   * preview so the real animated reveal can take over without the two
   * overlapping. Null if the player never actually went through the
   * composer at all this session — callers should fall back to their own
   * default in that case.
   */
  consumeForReveal(): TextRevealConfig | null {
    // Defensive: the show can start (via the header's always-available
    // "ابدأ العرض") while the composer or control box is still open.
    this.stopPreviewCycle();
    this.root.classList.add('mzj-hidden');
    this.closeControlBox();
    this.previewText.visible = false;
    if (!this.hasCommittedOnce) return null;
    return { text: this.text, effect: this.effect, x: this.posX, y: this.posY, fontScale: this.scale };
  }

  private textStyle(): TextStyle {
    return new TextStyle({
      fontFamily: 'system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: Math.round(this.baseFontSize * this.scale),
      fontWeight: '800',
      fill: 0xffe9b3,
      stroke: { color: 0x2a1400, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3 },
      align: 'center',
    });
  }

  private query<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private wireInput(): void {
    const input = this.query<HTMLInputElement>('#mzj-text-composer-input');
    input.addEventListener('input', () => {
      this.text = input.value;
      this.previewText.text = this.text || SAMPLE_PHRASE;
    });
  }

  private wireEffectButtons(): void {
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.mzj-text-effect-btn'));
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        this.effect = btn.dataset.effect as TextRevealEffect;
        this.syncEffectButtons();
      });
    }
  }

  private syncEffectButtons(): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.mzj-text-effect-btn')) {
      btn.classList.toggle('active', btn.dataset.effect === this.effect);
    }
  }

  private wireBack(): void {
    this.query<HTMLButtonElement>('#mzj-text-composer-back').addEventListener('click', () => {
      this.stopPreviewCycle();
      this.root.classList.add('mzj-hidden');
      this.text = this.text.trim() ? this.text : SAMPLE_PHRASE;
      this.previewText.text = this.text;
      this.previewText.visible = true;
      this.syncPreviewTransform();
      this.openControlBox();
    });
  }

  /** Runs smoke -> flame -> none -> smoke -> ... forever, one at a time, using the exact same TextReveal engine as the real final reveal — only ever one preview actually animating. Independent of tapping an icon to select it. */
  private startPreviewCycle(): void {
    if (this.previewCycleActive) return;
    this.previewCycleActive = true;
    this.previewGeneration++;
    void this.runPreviewStep(this.previewGeneration);
  }

  private stopPreviewCycle(): void {
    this.previewCycleActive = false;
    this.previewGeneration++;
    window.clearTimeout(this.previewCycleTimer);
    this.previewReveal.clear();
  }

  /**
   * Per icon: show "مرحبا" plainly and statically first, hold briefly so
   * it's clearly read, then (for smoke/flame) run the real dissolve over
   * it — the exact same TextReveal engine as the final reveal, clipped to
   * this icon's own slot rectangle so nothing ever escapes it. 'none' just
   * holds the static word for a comparable beat, since it has no effect to
   * demonstrate. Advances to the next icon once done, looping forever.
   */
  private async runPreviewStep(generation: number): Promise<void> {
    if (!this.previewCycleActive || generation !== this.previewGeneration) return;

    const effect = PREVIEW_ORDER[this.previewIndex];
    const slot = this.root.querySelector<HTMLElement>(`.mzj-text-effect-preview[data-effect="${effect}"]`)!;
    const rect = slot.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const fontScale = (rect.height * 0.4) / this.baseFontSize;

    this.previewMask.clear().rect(rect.left, rect.top, rect.width, rect.height).fill(0xffffff);

    // Static, clearly-readable "مرحبا" first — no effect yet.
    await this.previewReveal.reveal(PREVIEW_PHRASE, { effect: 'none', x, y, fontScale });
    if (!this.previewCycleActive || generation !== this.previewGeneration) return;

    if (effect === 'none') {
      await this.previewWait(PREVIEW_NONE_HOLD_MS);
    } else {
      await this.previewWait(PREVIEW_HOLD_BEFORE_MS);
      if (!this.previewCycleActive || generation !== this.previewGeneration) return;
      // Now the real dissolve passes over the already-visible word.
      await this.previewReveal.reveal(PREVIEW_PHRASE, { effect, x, y, fontScale });
      if (!this.previewCycleActive || generation !== this.previewGeneration) return;
      await this.previewWait(PREVIEW_HOLD_AFTER_MS);
    }
    if (!this.previewCycleActive || generation !== this.previewGeneration) return;

    this.previewIndex = (this.previewIndex + 1) % PREVIEW_ORDER.length;
    void this.runPreviewStep(generation);
  }

  private previewWait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.previewCycleTimer = window.setTimeout(resolve, ms);
    });
  }

  private openControlBox(): void {
    this.controlBoxRoot.classList.remove('mzj-hidden');
    this.syncControlBoxTransform();
    this.deps.onComposingChange(true);
  }

  private closeControlBox(): void {
    this.controlBoxRoot.classList.add('mzj-hidden');
    this.activePointers.clear();
    this.dragStart = null;
    this.pinchStartDist = null;
  }

  /** Tapping the backdrop outside the box commits it: chrome disappears, bare text stays at its last position/scale. */
  private commit(): void {
    this.closeControlBox();
    this.hasCommittedOnce = true;
    this.deps.onComposingChange(false);
  }

  private wireControlBox(): void {
    const box = this.controlBoxRoot.querySelector<HTMLDivElement>('#mzj-text-control-box')!;

    box.addEventListener('pointerdown', (event) => {
      // Capture is best-effort: without it a finger sliding off the box's
      // bounds would stop delivering move events to it, but a capture
      // failure must never abort tracking the pointer for the drag/pinch
      // math below.
      try {
        box.setPointerCapture(event.pointerId);
      } catch {
        // ignore — see above
      }
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.activePointers.size === 1) {
        this.dragStart = { x: event.clientX - this.posX, y: event.clientY - this.posY };
      } else if (this.activePointers.size === 2) {
        const [a, b] = Array.from(this.activePointers.values());
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchStartScale = this.scale;
      }
    });

    box.addEventListener('pointermove', (event) => {
      if (!this.activePointers.has(event.pointerId)) return;
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.activePointers.size >= 2 && this.pinchStartDist !== null) {
        const [a, b] = Array.from(this.activePointers.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        this.scale = clamp(this.pinchStartScale * (dist / this.pinchStartDist), MIN_SCALE, MAX_SCALE);
        this.syncPreviewTransform();
        this.syncControlBoxTransform();
      } else if (this.activePointers.size === 1 && this.dragStart) {
        this.posX = event.clientX - this.dragStart.x;
        this.posY = event.clientY - this.dragStart.y;
        this.syncPreviewTransform();
        this.syncControlBoxTransform();
      }
    });

    const endPointer = (event: PointerEvent) => {
      this.activePointers.delete(event.pointerId);
      if (this.activePointers.size < 2) this.pinchStartDist = null;
      if (this.activePointers.size < 1) this.dragStart = null;
    };
    box.addEventListener('pointerup', endPointer);
    box.addEventListener('pointercancel', endPointer);

    // Tapping the backdrop (anywhere in controlBoxRoot outside the box itself) commits.
    this.controlBoxRoot.addEventListener('pointerdown', (event) => {
      if (!box.contains(event.target as Node)) this.commit();
    });
  }

  private syncPreviewTransform(): void {
    this.previewText.position.set(this.posX, this.posY);
    this.previewText.style = this.textStyle();
  }

  private syncControlBoxTransform(): void {
    const box = this.controlBoxRoot.querySelector<HTMLDivElement>('#mzj-text-control-box')!;
    const bounds = this.previewText.getBounds();
    const padding = 14;
    box.style.left = `${bounds.x - padding}px`;
    box.style.top = `${bounds.y - padding}px`;
    box.style.width = `${bounds.width + padding * 2}px`;
    box.style.height = `${bounds.height + padding * 2}px`;
  }

  private template(): string {
    return `
      <div class="mzj-text-composer-topbar">
        <button type="button" id="mzj-text-composer-back" aria-label="رجوع">${icon('arrowBack', 18)}</button>
        <input type="text" id="mzj-text-composer-input" class="mzj-text-composer-input" placeholder="اكتب عبارتك هنا" />
      </div>
      <div class="mzj-text-composer-effects">
        ${TEXT_EFFECTS.map((entry) => this.effectButton(entry.id, entry.label)).join('')}
      </div>
    `;
  }

  private effectButton(effect: TextRevealEffect, label: string): string {
    return `
      <button type="button" class="mzj-text-effect-btn" data-effect="${effect}">
        <span class="mzj-text-effect-preview" data-effect="${effect}"></span>
        <span>${label}</span>
      </button>
    `;
  }
}

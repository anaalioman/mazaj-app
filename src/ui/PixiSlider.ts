import { Application, Container, FederatedPointerEvent, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

/**
 * Geometry ported 1:1 from the old `.mcp-slider-row` CSS, measured off a
 * live open subpanel (getBoundingClientRect on the label/input/output):
 * label fixed 90px (right-most — RTL reading order), output fixed 30px
 * (left-most), track fills whatever's left between them, 6px gaps.
 */
const LABEL_WIDTH = 90;
const OUTPUT_WIDTH = 30;
const GAP = 6;
const TRACK_HEIGHT = 4;
const THUMB_RADIUS = 8;
/** Real Pixi hitArea per finger, same reasoning as every other converted control. */
const THUMB_HIT_SIZE = 44;
const TRACK_COLOR = 0xffffff;
const TRACK_ALPHA = 0.16;
/** The old CSS's `accent-color: #ff9f45` (native range-input fill/thumb tint). */
const FILL_COLOR = 0xff9f45;
const LABEL_COLOR = 0xffffff;
const LABEL_ALPHA = 0.85;
/** The old CSS output's `color: #ffe9b3`. */
const OUTPUT_COLOR = 0xffe9b3;

export interface PixiSliderOptions {
  app: Application;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Total width available for the whole row (label + track + output) — the caller (a subpanel) owns this, since it depends on the panel's own width. */
  width: number;
  onChange: (value: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, min: number, step: number): number {
  return Math.round((value - min) / step) * step + min;
}

function formatValue(value: number, step: number): string {
  const decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
  return value.toFixed(decimals);
}

/**
 * One label+track+thumb+value row — the Pixi equivalent of a native
 * `<input type="range">` styled by the old `.mcp-slider-row` CSS, since no
 * such widget exists anywhere else in this codebase yet. Drag is wired the
 * same way every other draggable control in this app is: `pointerdown` on
 * the thumb starts it, `pointermove`/`pointerup` are handled on
 * `app.stage` (PlanningMode.ts's own idiom) so a fast finger sliding off
 * the small thumb never drops the drag.
 */
export class PixiSlider {
  readonly container: Container;
  private readonly app: Application;
  private readonly min: number;
  private readonly max: number;
  private readonly step: number;
  private readonly onChange: (value: number) => void;
  private readonly label: Text;
  private readonly track: Graphics;
  private readonly fill: Graphics;
  private readonly thumb: Graphics;
  private readonly output: Text;
  private trackWidth = 0;
  private trackLeftX = 0;
  private value: number;
  private dragging = false;

  constructor(options: PixiSliderOptions) {
    this.app = options.app;
    this.min = options.min;
    this.max = options.max;
    this.step = options.step;
    this.value = options.value;
    this.onChange = options.onChange;

    this.container = new Container();

    this.label = new Text({
      text: options.label,
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: 11, fill: LABEL_COLOR }),
    });
    this.label.alpha = LABEL_ALPHA;
    this.label.anchor.set(1, 0.5);
    this.container.addChild(this.label);

    this.track = new Graphics();
    this.track.eventMode = 'static';
    this.track.cursor = 'pointer';
    this.container.addChild(this.track);

    this.fill = new Graphics();
    this.container.addChild(this.fill);

    this.thumb = new Graphics();
    this.thumb.circle(0, 0, THUMB_RADIUS).fill(FILL_COLOR);
    this.thumb.eventMode = 'static';
    this.thumb.cursor = 'grab';
    this.thumb.hitArea = new Rectangle(-THUMB_HIT_SIZE / 2, -THUMB_HIT_SIZE / 2, THUMB_HIT_SIZE, THUMB_HIT_SIZE);
    this.container.addChild(this.thumb);

    this.output = new Text({
      text: formatValue(this.value, this.step),
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: 11,
        fill: OUTPUT_COLOR,
      }),
    });
    this.output.anchor.set(0, 0.5);
    this.container.addChild(this.output);

    this.layout(options.width);
    this.wireInput();
  }

  /** Called by the owning subpanel if its own width changes (e.g. on screen resize). */
  layout(totalWidth: number): void {
    this.trackWidth = Math.max(20, totalWidth - LABEL_WIDTH - OUTPUT_WIDTH - GAP * 2);
    // RTL reading order: label right-most, output left-most, track between — same as the old flex row.
    const labelX = totalWidth;
    const trackRight = labelX - LABEL_WIDTH - GAP;
    const trackLeft = trackRight - this.trackWidth;
    const outputX = trackLeft - GAP - OUTPUT_WIDTH;

    this.label.position.set(labelX, 0);
    this.output.position.set(outputX, 0);

    this.track.clear().roundRect(trackLeft, -TRACK_HEIGHT / 2, this.trackWidth, TRACK_HEIGHT, TRACK_HEIGHT / 2).fill({
      color: TRACK_COLOR,
      alpha: TRACK_ALPHA,
    });
    this.track.hitArea = new Rectangle(trackLeft, -THUMB_HIT_SIZE / 2, this.trackWidth, THUMB_HIT_SIZE);

    this.trackLeftX = trackLeft;
    this.syncThumbAndFill();
  }

  private syncThumbAndFill(): void {
    const t = (this.value - this.min) / (this.max - this.min);
    const thumbX = this.trackLeftX + t * this.trackWidth;
    this.thumb.position.set(thumbX, 0);
    this.fill.clear().roundRect(this.trackLeftX, -TRACK_HEIGHT / 2, thumbX - this.trackLeftX, TRACK_HEIGHT, TRACK_HEIGHT / 2).fill(FILL_COLOR);
    this.output.text = formatValue(this.value, this.step);
  }

  private setValueFromLocalX(localX: number): void {
    const t = clamp((localX - this.trackLeftX) / this.trackWidth, 0, 1);
    const raw = this.min + t * (this.max - this.min);
    const stepped = clamp(roundToStep(raw, this.min, this.step), this.min, this.max);
    if (stepped === this.value) return;
    this.value = stepped;
    this.syncThumbAndFill();
    this.onChange(this.value);
  }

  private wireInput(): void {
    const startDrag = (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.dragging = true;
      this.setValueFromLocalX(this.container.toLocal(event.global).x);
    };
    this.thumb.on('pointerdown', startDrag);
    this.track.on('pointerdown', startDrag);

    this.app.stage.on('pointermove', (event: FederatedPointerEvent) => {
      if (!this.dragging) return;
      this.setValueFromLocalX(this.container.toLocal(event.global).x);
    });
    const endDrag = () => {
      this.dragging = false;
    };
    this.app.stage.on('pointerup', endDrag);
    this.app.stage.on('pointerupoutside', endDrag);
  }
}

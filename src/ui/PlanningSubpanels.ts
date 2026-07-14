import { Application, Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import { BottomSheetPanel } from './BottomSheetPanel';
import { PixiSlider } from './PixiSlider';
import type { AudioManager } from '../audio/AudioManager';

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

const ROW_HEIGHT = 24;

/**
 * One or more slider rows in a bottom sheet — used for the "إضاءة
 * الخلفية"/"توهج الألعاب النارية" (1 row each) and "المختبر" (4 rows)
 * panels alike, since they only ever differ by which/how-many sliders they
 * hold.
 */
export class SliderSheetPanel extends BottomSheetPanel {
  constructor(app: Application, specs: SliderSpec[]) {
    super(app);
    const origin = this.contentOrigin;

    specs.forEach((spec, index) => {
      const slider = new PixiSlider({
        app,
        label: spec.label,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value: spec.value,
        width: this.contentWidth,
        onChange: spec.onChange,
      });
      slider.container.position.set(origin.x, origin.y + index * ROW_HEIGHT + ROW_HEIGHT / 2);
      this.addContent(slider.container);
    });

    this.finalize(specs.length * ROW_HEIGHT);
  }
}

const CHOICE_HEIGHT = 40;
const CHOICE_GAP = 8;

/** "فيديو خلفية حي"'s picker: two side-by-side choice buttons, the Pixi equivalent of the old `.mzj-planning-choice-btn` pair. */
export class CameraPickerPanel extends BottomSheetPanel {
  private readonly audio: AudioManager;

  constructor(app: Application, audio: AudioManager, onUpload: () => void, onLive: () => void) {
    super(app);
    this.audio = audio;
    const origin = this.contentOrigin;
    const buttonWidth = (this.contentWidth - CHOICE_GAP) / 2;

    const uploadButton = this.buildChoiceButton('رفع فيديو', buttonWidth, onUpload);
    uploadButton.position.set(origin.x + buttonWidth / 2, origin.y + CHOICE_HEIGHT / 2);
    this.addContent(uploadButton);

    const liveButton = this.buildChoiceButton('توثيق مباشر', buttonWidth, onLive);
    liveButton.position.set(origin.x + buttonWidth + CHOICE_GAP + buttonWidth / 2, origin.y + CHOICE_HEIGHT / 2);
    this.addContent(liveButton);

    this.finalize(CHOICE_HEIGHT);
  }

  private buildChoiceButton(label: string, width: number, onTap: () => void): Container {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-width / 2, -CHOICE_HEIGHT / 2, width, CHOICE_HEIGHT);

    const bg = new Graphics().roundRect(-width / 2, -CHOICE_HEIGHT / 2, width, CHOICE_HEIGHT, 10).fill({ color: 0xffffff, alpha: 0.06 });
    root.addChild(bg);

    const text = new Text({
      text: label,
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: 13, fontWeight: '600', fill: 0xffffff }),
    });
    text.alpha = 0.85;
    text.anchor.set(0.5);
    root.addChild(text);

    root.on('pointerdown', (event) => event.stopPropagation());
    root.on('pointertap', (event) => {
      event.stopPropagation();
      this.audio.playUiClick();
      onTap();
    });
    return root;
  }
}

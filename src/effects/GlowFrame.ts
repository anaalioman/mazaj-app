import { Application, BlurFilter, Container, Graphics, Text, TextStyle } from 'pixi.js';

export type GlowFrameShape = 'heart' | 'star' | 'circle';

const SHAPE_COLORS: Record<GlowFrameShape, number> = {
  heart: 0xff5a7a,
  star: 0xffd23f,
  circle: 0x7cf5ff,
};

/**
 * A greeting phrase wrapped in a neon-outlined shape (heart / star / halo
 * circle). Shown on demand from the control panel; calling `show()` again
 * replaces whatever was there before.
 */
export class GlowFrame {
  private readonly app: Application;
  private group: Container | null = null;

  constructor(app: Application) {
    this.app = app;
  }

  show(text: string, shape: GlowFrameShape): void {
    const trimmed = text.trim();
    this.clear();
    if (!trimmed) return;

    const color = SHAPE_COLORS[shape];
    const group = new Container();
    group.position.set(this.app.screen.width / 2, this.app.screen.height * 0.62);

    // Blurred halo behind a crisp outline is what actually reads as "neon"
    // rather than a flat colored line.
    const halo = new Graphics();
    this.drawShape(halo, shape, color, 16);
    halo.filters = [new BlurFilter({ strength: 6 })];

    const outline = new Graphics();
    this.drawShape(outline, shape, color, 4);
    outline.blendMode = 'add';

    const style = new TextStyle({
      fontFamily: 'system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: 26,
      fontWeight: '700',
      fill: 0xffffff,
      stroke: { color: 0x1a0a24, width: 4 },
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 200,
    });
    const label = new Text({ text: trimmed, style });
    label.anchor.set(0.5);

    group.addChild(halo, outline, label);
    this.app.stage.addChild(group);
    this.group = group;
  }

  clear(): void {
    if (!this.group) return;
    this.app.stage.removeChild(this.group);
    this.group.destroy({ children: true });
    this.group = null;
  }

  private drawShape(g: Graphics, shape: GlowFrameShape, color: number, width: number): void {
    switch (shape) {
      case 'heart':
        this.pathHeart(g);
        break;
      case 'star':
        this.pathStar(g);
        break;
      default:
        g.circle(0, 0, 92);
        break;
    }
    g.stroke({ width, color, alpha: 0.9 });
  }

  private pathHeart(g: Graphics): void {
    const s = 3.2;
    g.moveTo(0, 12 * s);
    g.bezierCurveTo(-24 * s, -10 * s, -13 * s, -26 * s, 0, -8 * s);
    g.bezierCurveTo(13 * s, -26 * s, 24 * s, -10 * s, 0, 12 * s);
    g.closePath();
  }

  private pathStar(g: Graphics): void {
    const spikes = 5;
    const outerRadius = 95;
    const innerRadius = 42;
    const points: number[] = [];

    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (Math.PI / spikes) * i - Math.PI / 2;
      points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }

    g.poly(points);
  }
}

import './style.css';
import { Application, Container, Graphics } from 'pixi.js';
import { FireworksSystem } from './fireworks/FireworksSystem';

const container = document.querySelector<HTMLDivElement>('#app')!;

const app = new Application();

await app.init({
  resizeTo: window,
  background: '#030512',
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});

container.appendChild(app.canvas);

drawStarfield(app);

const fireworks = new FireworksSystem(app, { autoLaunch: true });

app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.renderer.on('resize', () => {
  app.stage.hitArea = app.screen;
});

app.stage.on('pointerdown', (event) => {
  const { x, y } = event.global;
  fireworks.launch(x, y);
});

app.ticker.add((ticker) => {
  fireworks.update(ticker.deltaTime);
});

function drawStarfield(app: Application): void {
  const stars = new Container();
  const graphics = new Graphics();
  const count = 140;

  for (let i = 0; i < count; i++) {
    const x = Math.random() * app.screen.width;
    const y = Math.random() * app.screen.height * 0.75;
    const r = Math.random() * 1.2 + 0.3;
    graphics.circle(x, y, r).fill({ color: 0xffffff, alpha: 0.3 + Math.random() * 0.5 });
  }

  stars.addChild(graphics);
  app.stage.addChild(stars);
}

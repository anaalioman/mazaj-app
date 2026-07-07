import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';

function coverFit(sprite: Sprite, width: number, height: number): void {
  const scale = Math.max(width / sprite.texture.width, height / sprite.texture.height);
  sprite.width = sprite.texture.width * scale;
  sprite.height = sprite.texture.height * scale;
  sprite.position.set(width / 2, height / 2);
}

/** Dim starfield used when the player hasn't uploaded a celebration photo. */
export function drawStarfield(app: Application): Container {
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
  app.stage.addChildAt(stars, 0);
  return stars;
}

/** Loads a user-supplied photo and displays it full-screen, cover-fit, behind the show. */
export async function setBackgroundImage(app: Application, file: File, previous: Container): Promise<Sprite> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();

    const sprite = new Sprite(Texture.from(image));
    sprite.anchor.set(0.5);
    coverFit(sprite, app.screen.width, app.screen.height);

    app.stage.addChildAt(sprite, 0);
    app.renderer.on('resize', () => coverFit(sprite, app.screen.width, app.screen.height));

    app.stage.removeChild(previous);
    previous.destroy({ children: true });

    return sprite;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

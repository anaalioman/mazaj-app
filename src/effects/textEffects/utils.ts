export function pick(colors: number[]): number {
  return colors[Math.floor(Math.random() * colors.length)];
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Per-channel lerp via bit-shifting — no allocations, no texture/sprite work. */
export function lerpColor(from: number, to: number, t: number): number {
  const ratio = clamp01(t);
  const r = ((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * ratio;
  const g = ((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * ratio;
  const b = (from & 0xff) + ((to & 0xff) - (from & 0xff)) * ratio;
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

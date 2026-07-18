/**
 * Pure motion integration — no PixiJS imports, no rendering concerns, no
 * particle/sprite state. Every moving thing in `fireworks/` (burst sparks in
 * `Particle.ts`, the ascending shell in `Rocket.ts`, ground-fountain sparks
 * in `GroundFountain.ts`) composes these same three functions instead of
 * each hand-rolling its own copy of the drag/gravity arithmetic — they
 * differ only in which drag/gravity values they pass in (e.g. Rocket has no
 * drag, so it passes `drag = 1`; GroundFountain has no gravity, so it
 * passes `gravity = 0`), not in the equations themselves.
 */

/** Exponential drag: velocity shrinks by a constant fraction every frame, scaled by delta implicitly through repeated per-frame calls. */
export function applyDrag(velocityComponent: number, drag: number): number {
  return velocityComponent * drag;
}

/** Drag applied first, then a constant downward acceleration added — matches how vertical velocity is the one axis gravity acts on. */
export function applyDragAndGravity(verticalVelocity: number, drag: number, gravity: number, delta: number): number {
  return verticalVelocity * drag + gravity * delta;
}

/** Position += velocity * delta — frame-rate independent as long as `delta` is the engine's own normalized frame delta (PixiJS ticker's `deltaTime`/`deltaFrames`), not a raw millisecond count. */
export function integratePosition(position: number, velocity: number, delta: number): number {
  return position + velocity * delta;
}

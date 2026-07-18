/**
 * Generic dead-object pool, shared by `FireworksSystem` (pooling `Particle`
 * instances across every burst pattern) and `GroundFountain` (pooling its
 * own spark `Particle`s) — one implementation instead of each hand-rolling
 * its own array + pop/push.
 *
 * `pop()` reuses a dead instance if one's available, otherwise calls
 * `create()` exactly once for a genuine pool miss. `push()` returns a dead
 * instance for later reuse. The pool itself only tracks which instances are
 * currently available — resetting/hiding an instance's own visible state
 * (e.g. `Particle.kill()`, GroundFountain's `alpha = 0`) is the caller's
 * job, done immediately before calling `push()`.
 */
export class ParticlePool<T> {
  private readonly dead: T[] = [];
  private readonly create: () => T;

  constructor(create: () => T) {
    this.create = create;
  }

  pop(): T {
    return this.dead.pop() ?? this.create();
  }

  push(item: T): void {
    this.dead.push(item);
  }
}

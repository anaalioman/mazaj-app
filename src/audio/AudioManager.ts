import type { Application } from 'pixi.js';
import { withTimeout } from '../utils/withTimeout';

// Sound cues for the show. Audio files are expected to be dropped into
// public/audio/ later (see public/audio/README.md) — until then every
// sound silently no-ops so the rest of the app works with zero changes
// once real files show up.
const SOUND_FILES = {
  reveal: '/audio/reveal.mp3',
  launch: '/audio/launch.mp3',
  launchVariant: '/audio/gearpile-explosion-3-386885.mp3',
  explosion: '/audio/explosion.mp3',
  // A lighter, more distant-sounding boom used for bursts that land well off
  // the horizontal center — reads as if it came from a different mortar
  // station rather than every shell sounding identical.
  explosionDistant: '/audio/brvhrtz-boom-03-279195.mp3',
  crackle1: '/audio/67213_cracklr-spark_1.mp3',
  crackle2: '/audio/29367_freesound_community-firework-s_1.mp3',
} as const;

type SoundName = keyof typeof SOUND_FILES;

// Stylized "speed of sound" across the scene (px/sec) — not physically
// accurate to real air, just fast enough that near bursts feel almost
// instant while far ones visibly lag behind their flash, like a real show.
const SOUND_SPEED_PX_PER_SEC = 700;
// Below this distance a burst plays at full volume; beyond it, volume falls
// off with the inverse square of distance, floored so nothing goes silent.
const REFERENCE_DISTANCE = 160;
const MIN_VOLUME_FACTOR = 0.08;
// Bursts whose x lands beyond this fraction of the half-width from center
// count as "off-center" and get the more distant-sounding boom.
const OFF_CENTER_RATIO = 0.5;
const CRACKLE_MIN_DELAY_MS = 90;
const CRACKLE_MAX_DELAY_MS = 190;

export class AudioManager {
  private readonly app: Application;
  private readonly context: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly missing = new Set<SoundName>();
  private loaded = false;
  private muted = false;

  constructor(app: Application) {
    this.app = app;
    this.context = new AudioContext();
    this.destination = this.context.createMediaStreamDestination();
  }

  /** The stream to feed into the video recorder alongside the canvas track. */
  getRecordingStream(): MediaStream {
    return this.destination.stream;
  }

  /**
   * Must be called from a user gesture (browsers block audio otherwise).
   * Guarded by a timeout: some Android WebView builds leave
   * AudioContext.resume() pending forever instead of resolving/rejecting,
   * which must never be allowed to block the rest of the show.
   */
  async unlock(): Promise<void> {
    try {
      await withTimeout(this.unlockInner(), 2000, 'AudioManager.unlock');
    } catch (error) {
      console.warn('تعذّر تفعيل الصوت (سيتابع العرض بصريًا بدون صوت):', error);
    }
  }

  private async unlockInner(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    if (!this.loaded) {
      this.loaded = true;
      await Promise.all((Object.keys(SOUND_FILES) as SoundName[]).map((name) => this.load(name)));
    }
  }

  playReveal(): void {
    this.play('reveal', 0.5);
  }

  /** Simple random variation between the two launch takes, when both loaded. */
  playLaunch(): void {
    this.play(this.pickLoaded('launch', 'launchVariant'), 0.35);
  }

  /**
   * Plays the explosion as if it physically happened at (x, y), with the
   * listener planted at the bottom-center of the screen: the sound is
   * delayed by travel time and attenuated by inverse-square distance falloff.
   * Bursts landing well off the horizontal center get the lighter, more
   * "distant" boom take instead of the main one, then a trailing crackle
   * layers in shortly after — like a real shell's sparkle tail.
   */
  playExplosion(x: number, y: number): void {
    const listenerX = this.app.screen.width / 2;
    const listenerY = this.app.screen.height;
    const distance = Math.max(Math.hypot(x - listenerX, y - listenerY), 1);

    const falloffDistance = Math.max(distance, REFERENCE_DISTANCE);
    const attenuation = Math.max((REFERENCE_DISTANCE / falloffDistance) ** 2, MIN_VOLUME_FACTOR);
    const volume = 0.5 * attenuation;
    const delayMs = (distance / SOUND_SPEED_PX_PER_SEC) * 1000;

    const isOffCenter = Math.abs(x - listenerX) > (this.app.screen.width / 2) * OFF_CENTER_RATIO;
    const explosionName = isOffCenter ? this.pickLoaded('explosionDistant', 'explosion') : 'explosion';

    window.setTimeout(() => {
      this.play(explosionName, volume);
      this.playCrackle(volume);
    }, delayMs);
  }

  private playCrackle(explosionVolume: number): void {
    const name = this.pickLoaded('crackle1', 'crackle2');
    if (!this.buffers.has(name)) return; // neither crackle take has loaded — skip silently
    const crackleDelay = CRACKLE_MIN_DELAY_MS + Math.random() * (CRACKLE_MAX_DELAY_MS - CRACKLE_MIN_DELAY_MS);
    window.setTimeout(() => this.play(name, explosionVolume * 0.5), crackleDelay);
  }

  /**
   * Loops a sizzling bed for the Ground Fountain's duration. No dedicated
   * continuous hiss sample was provided, so this reuses one of the crackle
   * takes looped — swap in a real sizzle/hiss sample later if one shows up.
   * Returns a `stop()` that fades out over 0.6s rather than cutting abruptly.
   */
  startFountainSizzle(): () => void {
    const name = this.pickLoaded('crackle1', 'crackle2');
    const buffer = this.buffers.get(name);
    if (this.muted || !buffer) return () => {};

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.2);

    source.connect(gain);
    gain.connect(this.context.destination);
    gain.connect(this.destination);
    source.start();

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const stopAt = this.context.currentTime;
      gain.gain.cancelScheduledValues(stopAt);
      gain.gain.setValueAtTime(gain.gain.value, stopAt);
      gain.gain.linearRampToValueAtTime(0, stopAt + 0.6);
      source.stop(stopAt + 0.65);
    };
  }

  /** Randomly picks among whichever of these takes actually loaded; falls back to the first name if none did. */
  private pickLoaded(...names: SoundName[]): SoundName {
    const available = names.filter((name) => this.buffers.has(name));
    if (available.length === 0) return names[0];
    return available[Math.floor(Math.random() * available.length)];
  }

  /** True if one or more sound files haven't been added to public/audio/ yet. */
  hasMissingSounds(): boolean {
    return this.missing.size > 0;
  }

  /** Toggles master mute; returns the new muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Short synthesized mechanical tick for UI presses — no audio file needed. */
  playUiClick(): void {
    if (this.muted) return;

    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.03);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(this.context.destination);
    gain.connect(this.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  private async load(name: SoundName): Promise<void> {
    try {
      const response = await fetch(SOUND_FILES[name]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
      this.buffers.set(name, audioBuffer);
    } catch {
      // Expected until real audio files are added to public/audio/.
      this.missing.add(name);
    }
  }

  private play(name: SoundName, volume: number): void {
    if (this.muted) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;

    const gain = this.context.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(this.context.destination);
    gain.connect(this.destination);

    source.start();
  }
}

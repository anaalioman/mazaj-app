import type { Application } from 'pixi.js';
import { withTimeout } from '../utils/withTimeout';

// Sound cues for the show. Audio files are expected to be dropped into
// public/audio/ later (see public/audio/README.md) — until then every
// sound silently no-ops so the rest of the app works with zero changes
// once real files show up.
const SOUND_FILES = {
  reveal: '/audio/reveal.mp3',
  launch: '/audio/launch.mp3',
  explosion: '/audio/explosion.mp3',
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

  playLaunch(): void {
    this.play('launch', 0.35);
  }

  /**
   * Plays the explosion as if it physically happened at (x, y), with the
   * listener planted at the bottom-center of the screen: the sound is
   * delayed by travel time and attenuated by inverse-square distance falloff.
   */
  playExplosion(x: number, y: number): void {
    const listenerX = this.app.screen.width / 2;
    const listenerY = this.app.screen.height;
    const distance = Math.max(Math.hypot(x - listenerX, y - listenerY), 1);

    const falloffDistance = Math.max(distance, REFERENCE_DISTANCE);
    const attenuation = Math.max((REFERENCE_DISTANCE / falloffDistance) ** 2, MIN_VOLUME_FACTOR);
    const volume = 0.5 * attenuation;
    const delayMs = (distance / SOUND_SPEED_PX_PER_SEC) * 1000;

    window.setTimeout(() => this.play('explosion', volume), delayMs);
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

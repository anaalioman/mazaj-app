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

export class AudioManager {
  private readonly context: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly missing = new Set<SoundName>();
  private loaded = false;

  constructor() {
    this.context = new AudioContext();
    this.destination = this.context.createMediaStreamDestination();
  }

  /** The stream to feed into the video recorder alongside the canvas track. */
  getRecordingStream(): MediaStream {
    return this.destination.stream;
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  async unlock(): Promise<void> {
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

  playExplosion(): void {
    this.play('explosion', 0.45);
  }

  /** True if one or more sound files haven't been added to public/audio/ yet. */
  hasMissingSounds(): boolean {
    return this.missing.size > 0;
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

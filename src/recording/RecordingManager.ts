import { triggerDownload } from '../dom/shadowServices';

const CANDIDATE_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType(): string {
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/** Records the canvas (video) combined with an audio stream, and hands back a downloadable file. */
export class RecordingManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly audioStream: MediaStream;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private canvasStream: MediaStream | null = null;

  constructor(canvas: HTMLCanvasElement, audioStream: MediaStream) {
    this.canvas = canvas;
    this.audioStream = audioStream;
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  start(): void {
    if (this.isRecording) return;

    this.canvasStream = this.canvas.captureStream(30);
    const combined = new MediaStream([
      ...this.canvasStream.getVideoTracks(),
      ...this.audioStream.getAudioTracks(),
    ]);

    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('لا يوجد تسجيل قيد التشغيل'));
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'video/webm' });
        this.chunks = [];
        this.canvasStream?.getTracks().forEach((track) => track.stop());
        this.canvasStream = null;
        resolve(blob);
      };
      recorder.stop();
    });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

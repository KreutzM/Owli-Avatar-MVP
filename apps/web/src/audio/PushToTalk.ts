/**
 * Click-to-start/stop microphone capture. Call start() directly from the user's gesture.
 * stop() resolves to a WebM/Opus Blob; onTranscribing receives that same Blob for an
 * external caller to handle. This controller never uploads audio. cancel()/dispose() discard it.
 */
export interface PushToTalkOptions {
  onRecording?: (recording: boolean) => void;
  /** Called immediately before MediaRecorder.stop(), including the duration limit. */
  onStopRequested?: () => void;
  onTranscribing?: (audio: Blob) => void;
  onError?: (error: Error) => void;
}

const MIME_TYPE = "audio/webm;codecs=opus";
const MAX_DURATION_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class PushToTalk {
  private generation = 0;
  private disposed = false;
  private starting = false;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopPromise: Promise<Blob> | null = null;
  private resolveStop: ((audio: Blob) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private readonly onRecording?: (recording: boolean) => void;
  private readonly onStopRequested?: () => void;
  private readonly onTranscribing?: (audio: Blob) => void;
  private readonly onError?: (error: Error) => void;

  constructor(options: PushToTalkOptions = {}) {
    this.onRecording = options.onRecording;
    this.onStopRequested = options.onStopRequested;
    this.onTranscribing = options.onTranscribing;
    this.onError = options.onError;
    window.addEventListener("pagehide", this.handlePageHide);
  }

  /** Request the microphone and start capture. Duplicate starts are ignored. */
  async start(): Promise<void> {
    if (this.disposed) throw new Error("PushToTalk is disposed");
    if (this.starting || this.recorder) return;
    if (!globalThis.isSecureContext) {
      throw this.report(new Error("Microphone access requires HTTPS or localhost"));
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw this.report(new Error("Microphone recording is not supported in this browser"));
    }
    if (!MediaRecorder.isTypeSupported(MIME_TYPE)) {
      throw this.report(new Error(`Recording format is not supported: ${MIME_TYPE}`));
    }

    const generation = ++this.generation;
    this.starting = true;
    let stream: MediaStream;
    try {
      // This call is deliberately made before the first await, while the user gesture is active.
      const permission = navigator.mediaDevices.getUserMedia({ audio: true });
      stream = await permission;
    } catch (error) {
      if (generation === this.generation) {
        this.starting = false;
        throw this.report(asError(error));
      }
      return;
    }

    if (this.disposed || generation !== this.generation) {
      this.stopTracks(stream);
      return;
    }

    try {
      this.stream = stream;
      const recorder = new MediaRecorder(stream, { mimeType: MIME_TYPE });
      this.recorder = recorder;
      this.chunks = [];
      this.bytes = 0;
      recorder.ondataavailable = (event: BlobEvent) => this.handleData(recorder, event.data);
      recorder.onerror = (event: Event) => this.fail(asError((event as ErrorEvent).error ?? "Recording failed"));
      recorder.onstop = () => this.finish(recorder);
      recorder.start(250);
      this.starting = false;
      this.onRecording?.(true);
      this.timer = setTimeout(() => { void this.stop().catch(() => undefined); }, MAX_DURATION_MS);
    } catch (error) {
      this.starting = false;
      this.clearCapture();
      throw this.report(asError(error));
    }
  }

  /** Stop capture and return its Blob; repeated calls share the same result. */
  stop(): Promise<Blob> {
    if (this.stopPromise) return this.stopPromise;
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      return Promise.reject(new Error("No active recording"));
    }
    this.stopPromise = new Promise<Blob>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    this.clearTimer();
    try {
      this.onStopRequested?.();
      recorder.stop();
    } catch (error) {
      this.fail(asError(error));
    }
    return this.stopPromise;
  }

  /** Cancel and discard the current or pending recording. */
  cancel(): void {
    if (this.disposed) return;
    this.generation++;
    this.starting = false;
    this.clearTimer();
    const recorder = this.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* Recorder may already have stopped. */ }
      }
    }
    this.clearCapture();
    this.rejectStop?.(new Error("Recording cancelled"));
    this.resetStopPromise();
    this.onRecording?.(false);
  }

  /** Cancel capture and remove page lifecycle handling. This instance cannot be reused. */
  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    window.removeEventListener("pagehide", this.handlePageHide);
  }

  private readonly handlePageHide = (): void => this.cancel();

  private handleData(recorder: MediaRecorder, data: Blob): void {
    if (this.recorder !== recorder || data.size === 0) return;
    this.bytes += data.size;
    if (this.bytes > MAX_BYTES) {
      this.fail(new Error("Recording exceeds the 5 MiB limit"));
      return;
    }
    this.chunks.push(data);
  }

  private finish(recorder: MediaRecorder): void {
    if (this.recorder !== recorder) return;
    const audio = new Blob(this.chunks, { type: MIME_TYPE });
    const resolve = this.resolveStop;
    const reject = this.rejectStop;
    this.clearCapture();
    this.resetStopPromise();
    this.onRecording?.(false);
    if (audio.size > MAX_BYTES) {
      const error = this.report(new Error("Recording exceeds the 5 MiB limit"));
      reject?.(error);
      return;
    }
    resolve?.(audio);
    this.onTranscribing?.(audio);
  }

  private fail(error: Error): void {
    const recorder = this.recorder;
    const reject = this.rejectStop;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* Recorder may already have stopped. */ }
      }
    }
    this.clearCapture();
    this.resetStopPromise();
    this.onRecording?.(false);
    const reported = this.report(error);
    reject?.(reported);
  }

  private clearCapture(): void {
    this.clearTimer();
    this.stopTracks(this.stream);
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.bytes = 0;
  }

  private stopTracks(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private resetStopPromise(): void {
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
  }

  private report(error: Error): Error {
    this.onError?.(error);
    return error;
  }
}

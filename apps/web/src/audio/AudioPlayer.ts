/** Small Web Audio playback controller for TTS WAV data and render-loop level sampling. */
export interface AudioPlayerOptions {
  /** Linear RMS floor below which the sampled level is treated as silence. Default: 0.025. */
  noiseGate?: number;
  /** Smoothing time constants, in seconds. Defaults: 0.035 attack and 0.16 release. */
  attackSeconds?: number;
  releaseSeconds?: number;
  /** Called once when the current source ends naturally. */
  onEnded?: () => void;
}

/**
 * Decode and play WAV ArrayBuffers through Web Audio. Call initialize() directly from a
 * user gesture; it creates/resumes AudioContext synchronously before returning its promise.
 * Call sampleLevel() from the app's existing render loop for a gated, smoothed [0, 1] RMS.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private volume = 1;
  private source: AudioBufferSourceNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private generation = 0;
  private level = 0;
  private lastSampleTime: number | null = null;
  private disposed = false;
  private readonly noiseGate: number;
  private readonly attackSeconds: number;
  private readonly releaseSeconds: number;
  private readonly onEnded?: () => void;

  constructor(options: AudioPlayerOptions = {}) {
    this.noiseGate = Math.max(0, options.noiseGate ?? 0.025);
    this.attackSeconds = Math.max(0.001, options.attackSeconds ?? 0.035);
    this.releaseSeconds = Math.max(0.001, options.releaseSeconds ?? 0.16);
    this.onEnded = options.onEnded;
  }

  /** Must be invoked from a user gesture to satisfy browser autoplay policies. */
  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("AudioPlayer is disposed"));
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 1024;
        this.gain = this.context.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.analyser);
        this.analyser.connect(this.context.destination);
        this.samples = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      }
      // Invoke resume before returning, while still in the caller's gesture stack.
      return this.context.state === "running" ? Promise.resolve() : this.context.resume();
    } catch (error) {
      this.resetLevel();
      return Promise.reject(error);
    }
  }

  /** Decode and start WAV bytes; a later play/stop/dispose makes pending decodes stale. */
  async playWav(data: ArrayBuffer): Promise<void> {
    if (this.disposed) throw new Error("AudioPlayer is disposed");
    const context = this.context;
    const analyser = this.analyser;
    if (!context || !analyser) throw new Error("Call initialize() before playWav()");
    const generation = ++this.generation;
    this.stopSource();
    this.resetLevel();
    try {
      const buffer = await context.decodeAudioData(data.slice(0));
      if (!this.isCurrent(generation)) return;
      if (context.state !== "running") await context.resume();
      if (!this.isCurrent(generation)) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain!);
      source.onended = () => {
        if (!this.isCurrent(generation) || this.source !== source) return;
        this.source = null;
        source.disconnect();
        this.resetLevel();
        this.onEnded?.();
      };
      this.source = source;
      source.start();
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.stopSource();
        this.resetLevel();
      }
      throw error;
    }
  }

  /** Return the latest analyser RMS, gated and attack/release smoothed, normalized [0, 1]. */
  sampleLevel(): number {
    const analyser = this.analyser;
    const samples = this.samples;
    const context = this.context;
    if (!this.source || !analyser || !samples || !context || context.state !== "running") {
      this.resetLevel();
      return 0;
    }
    analyser.getByteTimeDomainData(samples);
    let sumSquares = 0;
    for (const sample of samples) {
      const value = (sample - 128) / 128;
      sumSquares += value * value;
    }
    let target = Math.sqrt(sumSquares / samples.length);
    if (target <= this.noiseGate) target = 0;
    else target = Math.min(1, (target - this.noiseGate) / (1 - this.noiseGate));

    const now = context.currentTime;
    const dt = this.lastSampleTime === null ? 0 : Math.max(0, now - this.lastSampleTime);
    this.lastSampleTime = now;
    const tau = target > this.level ? this.attackSeconds : this.releaseSeconds;
    const alpha = dt === 0 ? (this.level === 0 && target > 0 ? 1 : 0) : 1 - Math.exp(-dt / tau);
    this.level += (target - this.level) * alpha;
    return Math.max(0, Math.min(1, this.level));
  }

  setVolume(value: number): void {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Stop playback and invalidate any pending decode/resume continuation. */
  stop(): void {
    this.generation++;
    this.stopSource();
    this.resetLevel();
  }

  /** Stop playback and close the AudioContext; the instance cannot be reused. */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    const context = this.context;
    this.context = null;
    this.analyser = null;
    this.gain = null;
    this.samples = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private stopSource(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* It may have ended between checks. */ }
      source.disconnect();
    }
  }

  private resetLevel(): void {
    this.level = 0;
    this.lastSampleTime = null;
  }
}

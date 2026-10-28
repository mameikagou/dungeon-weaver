import { ZZFX } from 'zzfx';
import type { GameEvent } from '../engine/simulation';

const sounds = {
  fire: [0.13, 0, 680, 0.002, 0.015, 0.07, 1, 1, -7],
  hit: [0.13, 0, 170, 0.002, 0.02, 0.09, 2, 1, -3],
  dash: [0.10, 0, 320, 0.015, 0.03, 0.15, 4, 1, 1],
  clear: [0.16, 0, 880, 0.01, 0.12, 0.3, 0, 1, 1],
};

export class GameAudio {
  muted = false;
  private readonly compressor = ZZFX.audioContext.createDynamicsCompressor();
  private readonly gain = ZZFX.audioContext.createGain();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly sources = new Set<AudioBufferSourceNode>();

  constructor() {
    this.gain.gain.value = 0.4;
    this.compressor.threshold.value = -16;
    this.compressor.ratio.value = 8;
    this.gain.connect(this.compressor).connect(ZZFX.audioContext.destination);
  }

  unlock(): void {
    if (!this.buffers.size) {
      for (const [name, parameters] of Object.entries(sounds)) {
        const samples = ZZFX.buildSamples(...parameters);
        const buffer = ZZFX.audioContext.createBuffer(1, samples.length, ZZFX.sampleRate);
        buffer.copyToChannel(samples, 0);
        this.buffers.set(name, buffer);
      }
    }
    void ZZFX.audioContext.resume().catch(error => console.warn('音频暂不可用', error));
  }

  play(event: GameEvent): void {
    if (this.muted || ZZFX.audioContext.state !== 'running' || this.sources.size >= 16) return;
    const buffer = this.buffers.get(event);
    if (!buffer) return;
    const source = ZZFX.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    source.start();
  }

  dispose(): void {
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.gain.disconnect();
    this.compressor.disconnect();
  }
}

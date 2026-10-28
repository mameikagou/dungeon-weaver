declare module 'zzfx' {
  export const ZZFX: {
    audioContext: AudioContext;
    sampleRate: number;
    buildSamples(...parameters: number[]): Float32Array<ArrayBuffer>;
  };
}

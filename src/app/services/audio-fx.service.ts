import { Injectable, signal } from '@angular/core';

import { EQ_BANDS } from './settings.service';

/**
 * Equaliser and loudness levelling, using the Web Audio API.
 *
 *   <audio> → 5 EQ filters → loudness levelling → volume → speakers
 *
 * Only switched on the first time the listener uses one of them, because from then on
 * songs must load through archive.org's /cors/ address (Web Audio needs that permission).
 * Volume and fades also go through here once it's on.
 */
@Injectable({ providedIn: 'root' })
export class AudioFxService {
  /** True once the sound goes through Web Audio. */
  readonly active = signal(false);

  private ctx?: AudioContext;
  private filters: BiquadFilterNode[] = [];
  private compressor?: DynamicsCompressorNode;
  private makeup?: GainNode;
  private volume?: GainNode;
  private levelling = false;

  /** Routes `audio` through the effects. Can only happen once per <audio> element. */
  start(audio: HTMLAudioElement): boolean {
    if (this.ctx) return true;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    try {
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audio);
      this.filters = EQ_BANDS.map((hz, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        f.frequency.value = hz;
        f.Q.value = 1;
        return f;
      });
      this.compressor = ctx.createDynamicsCompressor();
      this.makeup = ctx.createGain();
      this.volume = ctx.createGain();

      let node: AudioNode = source;
      for (const f of this.filters) { node.connect(f); node = f; }
      node.connect(this.compressor);
      this.compressor.connect(this.makeup);
      this.makeup.connect(this.volume);
      this.volume.connect(ctx.destination);

      this.ctx = ctx;
      this.setLevelling(false);
      this.active.set(true);
      return true;
    } catch {
      return false;
    }
  }

  /** Browsers start Web Audio paused until a tap; call before playing. */
  resume(): void {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  setGains(gains: number[]): void {
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i] ?? 0, this.ctx!.currentTime, 0.05));
  }

  /** Evens out quiet and loud uploads. Off = the compressor does nothing. */
  setLevelling(on: boolean): void {
    if (!this.compressor || !this.makeup || !this.ctx) return;
    this.levelling = on;
    const c = this.compressor;
    c.threshold.value = on ? -24 : 0;
    c.knee.value = on ? 12 : 0;
    c.ratio.value = on ? 4 : 1;
    c.attack.value = 0.01;
    c.release.value = 0.25;
    this.makeup.gain.value = on ? 1.6 : 1;
  }

  /** 0 … 1 */
  setVolume(value: number): void {
    if (this.volume && this.ctx) this.volume.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03);
  }

  get isLevelling(): boolean {
    return this.levelling;
  }
}

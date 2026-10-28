import { Injectable, signal } from '@angular/core';

import { EQ_BANDS } from './settings.service';

/**
 * All sound effects, using the Web Audio API.
 *
 *   <audio> → volume boost → 10-band EQ → bass → treble → even-out-loudness
 *           → stereo width / mono → balance + 8D → space (reverb) → volume → limiter → speakers
 *
 * Only switched on the first time the listener uses an effect, because from then on
 * songs must load through archive.org's /cors/ address (Web Audio needs that permission).
 * Volume and fades also go through here once it's on.
 */
@Injectable({ providedIn: 'root' })
export class AudioFxService {
  /** True once the sound goes through Web Audio. */
  readonly active = signal(false);

  private ctx?: AudioContext;
  private boost?: GainNode;
  private filters: BiquadFilterNode[] = [];
  private bass?: BiquadFilterNode;
  private treble?: BiquadFilterNode;
  private compressor?: DynamicsCompressorNode;
  private makeup?: GainNode;
  /** Stereo width matrix: left→left, right→left, right→right, left→right. */
  private width: GainNode[] = [];
  private panner?: StereoPannerNode;
  private orbit?: OscillatorNode;
  private orbitDepth?: GainNode;
  private reverb?: ConvolverNode;
  private wet?: GainNode;
  private dry?: GainNode;
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

      this.boost = ctx.createGain();
      this.filters = EQ_BANDS.map((hz, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        f.frequency.value = hz;
        f.Q.value = 1.4;
        return f;
      });
      this.bass = shelf(ctx, 'lowshelf', 90);
      this.treble = shelf(ctx, 'highshelf', 7000);
      this.compressor = ctx.createDynamicsCompressor();
      this.makeup = ctx.createGain();

      // Stereo width: mixes some of each side into the other (0 = mono) or takes it away (wider).
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      this.width = [0, 1, 2, 3].map(() => ctx.createGain());
      const [ll, rl, rr, lr] = this.width;
      split.connect(ll, 0); split.connect(rl, 1); split.connect(rr, 1); split.connect(lr, 0);
      ll.connect(merge, 0, 0); rl.connect(merge, 0, 0); rr.connect(merge, 0, 1); lr.connect(merge, 0, 1);

      // Balance, plus the slow circle of "8D audio".
      this.panner = ctx.createStereoPanner();
      this.orbit = ctx.createOscillator();
      this.orbit.frequency.value = 0.11; // one circle every ~9 seconds
      this.orbitDepth = ctx.createGain();
      this.orbitDepth.gain.value = 0;
      this.orbit.connect(this.orbitDepth);
      this.orbitDepth.connect(this.panner.pan);
      this.orbit.start();

      // Space (reverb): dry + wet mixed.
      this.reverb = ctx.createConvolver();
      this.wet = ctx.createGain();
      this.dry = ctx.createGain();
      this.wet.gain.value = 0;

      this.volume = ctx.createGain();
      // A limiter at the very end, so boost + bass never crackle.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.003; limiter.release.value = 0.12;

      let node: AudioNode = source;
      for (const n of [this.boost, ...this.filters, this.bass, this.treble, this.compressor, this.makeup]) { node.connect(n); node = n; }
      node.connect(split);
      merge.connect(this.panner);
      this.panner.connect(this.dry);
      this.panner.connect(this.reverb);
      this.reverb.connect(this.wet);
      this.dry.connect(this.volume);
      this.wet.connect(this.volume);
      this.volume.connect(limiter);
      limiter.connect(ctx.destination);

      this.ctx = ctx;
      this.setLevelling(false);
      this.setWidth(100);
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
    this.filters.forEach((f, i) => this.glide(f.gain, gains[i] ?? 0));
  }

  setBass(db: number): void { if (this.bass) this.glide(this.bass.gain, db); }
  setTreble(db: number): void { if (this.treble) this.glide(this.treble.gain, db); }
  setBoost(db: number): void { if (this.boost) this.glide(this.boost.gain, Math.pow(10, db / 20)); }

  /** 0 = mono, 100 = as recorded, 200 = extra wide. */
  setWidth(percent: number): void {
    if (this.width.length !== 4) return;
    const w = percent / 100;
    const same = (1 + w) / 2;
    const cross = (1 - w) / 2;
    const [ll, rl, rr, lr] = this.width;
    this.glide(ll.gain, same); this.glide(rr.gain, same);
    this.glide(rl.gain, cross); this.glide(lr.gain, cross);
  }

  /** -100 (left) … 100 (right) */
  setBalance(value: number): void { if (this.panner) this.glide(this.panner.pan, value / 100); }

  /** "8D audio": the song slowly circles from ear to ear. */
  set8D(on: boolean): void { if (this.orbitDepth) this.glide(this.orbitDepth.gain, on ? 0.85 : 0, 0.4); }

  /** Reverb length in seconds and how much of it to mix in (0 = off). */
  setSpace(seconds: number, wet: number): void {
    if (!this.ctx || !this.reverb || !this.wet || !this.dry) return;
    if (seconds > 0) this.reverb.buffer = impulse(this.ctx, seconds);
    this.glide(this.wet.gain, wet, 0.15);
    this.glide(this.dry.gain, 1 - wet * 0.35, 0.15);
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

  private glide(param: AudioParam, value: number, time = 0.05): void {
    if (this.ctx) param.setTargetAtTime(value, this.ctx.currentTime, time);
  }
}

function shelf(ctx: AudioContext, type: BiquadFilterType, hz: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  return f;
}

/** A made-up room echo: stereo noise that fades out over `seconds`. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
  }
  return buffer;
}

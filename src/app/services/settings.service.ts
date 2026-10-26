import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { StorageService } from './storage.service';

/* ==========================================================================
 *  Settings the listener can change (Settings ⚙ in the header).
 *  Everything is saved on the phone / in the browser and applied instantly.
 * ========================================================================== */

export interface Accent {
  key: string;
  name: string;
  /** Main colour: buttons, playing song, sliders */
  rose: string;
  /** Second colour of the play button gradient */
  rose2: string;
  /** Light tint: headings in italics, highlights */
  blush: string;
  /** End of the slider gradient */
  gold: string;
  /** Liked button */
  heart: string;
}

export const ACCENTS: Accent[] = [
  { key: 'rose', name: 'Rose', rose: '#ff6f91', rose2: '#ff9a8b', blush: '#ffc2d1', gold: '#ffd7a3', heart: '#ff3b5c' },
  { key: 'sunset', name: 'Sunset', rose: '#ff8a3d', rose2: '#ffb86b', blush: '#ffd3ad', gold: '#ffe39a', heart: '#ff5a3c' },
  { key: 'gold', name: 'Gold', rose: '#f2b93b', rose2: '#ffd76b', blush: '#ffe7ad', gold: '#fff1c9', heart: '#ff6b4a' },
  { key: 'mint', name: 'Mint', rose: '#35d49a', rose2: '#9ae66e', blush: '#c3f5dc', gold: '#f2f59a', heart: '#ff4f7a' },
  { key: 'ocean', name: 'Ocean', rose: '#3ebcff', rose2: '#6fe3d0', blush: '#bfeaff', gold: '#a8ffe0', heart: '#ff4f7a' },
  { key: 'violet', name: 'Violet', rose: '#a77bff', rose2: '#ff8ad8', blush: '#dccbff', gold: '#ffc2f0', heart: '#ff4f8b' },
];

export interface Sky { key: string; name: string; preview: string; }

/** Backgrounds. The colours themselves live in styles.scss (:root[data-sky=…]). */
export const SKIES: Sky[] = [
  { key: 'dusk', name: 'Dusk', preview: 'linear-gradient(160deg, #ff6f91 0%, #2a1240 55%, #160b29 100%)' },
  { key: 'midnight', name: 'Midnight', preview: 'linear-gradient(160deg, #26262e 0%, #000 60%)' },
  { key: 'ocean', name: 'Ocean', preview: 'linear-gradient(160deg, #2a8cff 0%, #0b2a4e 55%, #051228 100%)' },
  { key: 'monsoon', name: 'Monsoon', preview: 'linear-gradient(160deg, #3cc896 0%, #103a33 55%, #06171a 100%)' },
  { key: 'sunrise', name: 'Sunrise', preview: 'linear-gradient(160deg, #ffc878 0%, #5a1f2e 55%, #2a0f1a 100%)' },
];

/** Equaliser bands (Hz) and presets (dB per band). */
export const EQ_BANDS = [60, 230, 910, 3600, 14000];
export const EQ_LABELS = ['60', '230', '910', '3.6k', '14k'];

export interface EqPreset { key: string; name: string; gains: number[]; }

export const EQ_PRESETS: EqPreset[] = [
  { key: 'flat', name: 'Off', gains: [0, 0, 0, 0, 0] },
  { key: 'bass', name: 'Bass boost', gains: [6, 4, 0, 0, 1] },
  { key: 'vocal', name: 'Vocals', gains: [-2, -1, 3, 4, 1] },
  { key: 'warm', name: 'Old-school warm', gains: [3, 2, 0, -2, -4] },
  { key: 'party', name: 'Party', gains: [5, 2, -1, 2, 4] },
  { key: 'treble', name: 'Crisp', gains: [-1, 0, 0, 3, 6] },
  { key: 'car', name: 'Long drive', gains: [4, 1, 1, 2, 3] },
];

export const EQ_CUSTOM = 'custom';

export interface SavedSettings {
  accent: string;
  sky: string;
  lights: boolean;
  eqPreset: string;
  eqGains: number[];
  evenLoudness: boolean;
  fadeSeconds: number;
  wifiOnly: boolean;
  autoDownloadLiked: boolean;
}

const KEY = 'cfm.settings';
const DEFAULTS: SavedSettings = {
  accent: 'rose', sky: 'dusk', lights: true,
  eqPreset: 'flat', eqGains: [0, 0, 0, 0, 0], evenLoudness: false, fadeSeconds: 0,
  wifiOnly: true, autoDownloadLiked: false,
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly storage = inject(StorageService);
  private readonly saved = signal<SavedSettings>({ ...DEFAULTS, ...this.storage.get<Partial<SavedSettings>>(KEY, {}) });

  /** Settings panel open / closed */
  readonly open = signal(false);
  /** Section to scroll to when the panel opens (e.g. 'sleep' from the moon button). */
  readonly section = signal<string | null>(null);

  openAt(section: string | null = null): void {
    this.section.set(section);
    this.open.set(true);
  }

  // Appearance
  readonly accent = computed(() => ACCENTS.find(a => a.key === this.saved().accent) ?? ACCENTS[0]);
  readonly sky = computed(() => this.saved().sky);
  /** The floating lights in the background */
  readonly lights = computed(() => this.saved().lights);

  // Sound
  readonly eqPreset = computed(() => this.saved().eqPreset);
  readonly eqGains = computed(() => this.saved().eqGains);
  readonly evenLoudness = computed(() => this.saved().evenLoudness);
  /** Fade out the end of each song and fade in the next one (0 = off). */
  readonly fadeSeconds = computed(() => this.saved().fadeSeconds);
  /** The equaliser or loudness levelling is on, so sound goes through Web Audio. */
  readonly needsAudioEffects = computed(() => this.saved().evenLoudness || this.saved().eqGains.some(g => g !== 0));

  // Downloads
  readonly wifiOnly = computed(() => this.saved().wifiOnly);
  readonly autoDownloadLiked = computed(() => this.saved().autoDownloadLiked);

  constructor() {
    if (typeof document === 'undefined') return; // build script
    effect(() => this.applyAccent(this.accent()));
    effect(() => { document.documentElement.dataset['sky'] = this.sky(); });
  }

  setAccent(key: string): void { this.update({ accent: key }); }
  setSky(key: string): void { this.update({ sky: key }); }
  setLights(on: boolean): void { this.update({ lights: on }); }
  setEvenLoudness(on: boolean): void { this.update({ evenLoudness: on }); }
  setFadeSeconds(seconds: number): void { this.update({ fadeSeconds: seconds }); }
  setWifiOnly(on: boolean): void { this.update({ wifiOnly: on }); }
  setAutoDownloadLiked(on: boolean): void { this.update({ autoDownloadLiked: on }); }

  setEqPreset(key: string): void {
    const preset = EQ_PRESETS.find(p => p.key === key);
    if (preset) this.update({ eqPreset: key, eqGains: [...preset.gains] });
  }

  /** One slider moved: becomes a "Custom" setting. */
  setEqBand(index: number, db: number): void {
    const gains = [...this.eqGains()];
    gains[index] = db;
    const match = EQ_PRESETS.find(p => p.gains.every((g, i) => g === gains[i]));
    this.update({ eqGains: gains, eqPreset: match?.key ?? EQ_CUSTOM });
  }

  /** All settings, for backing up to the listener's account. */
  readonly snapshot = computed(() => this.saved());

  /** Settings restored from the account. */
  restore(saved: Partial<SavedSettings>): void {
    this.saved.set({ ...DEFAULTS, ...this.saved(), ...saved });
    this.storage.set(KEY, this.saved());
  }

  resetAll(): void {
    this.saved.set({ ...DEFAULTS });
    this.storage.set(KEY, this.saved());
  }

  private update(change: Partial<SavedSettings>): void {
    this.saved.update(s => ({ ...s, ...change }));
    this.storage.set(KEY, this.saved());
  }

  private applyAccent(a: Accent): void {
    const style = document.documentElement.style;
    style.setProperty('--rose', a.rose);
    style.setProperty('--rose-rgb', hexToRgb(a.rose));
    style.setProperty('--rose-2', a.rose2);
    style.setProperty('--blush', a.blush);
    style.setProperty('--blush-rgb', hexToRgb(a.blush));
    style.setProperty('--gold', a.gold);
    style.setProperty('--heart', a.heart);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--night').trim() || '#140c26');
  }
}

/** "#ff6f91" → "255, 111, 145" (for rgba(var(--rose-rgb), 0.5) in the styles) */
export function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

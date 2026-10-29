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

/** 10-band equaliser (Hz) and presets (dB per band). */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const FLAT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export interface EqPreset { key: string; name: string; gains: number[]; }

export const EQ_PRESETS: EqPreset[] = [
  { key: 'flat', name: 'Off', gains: FLAT },
  { key: 'bollywood', name: 'Bollywood', gains: [3, 3, 2, 0, -1, 1, 3, 3, 2, 1] },
  { key: 'bass', name: 'Bass boost', gains: [7, 6, 5, 2, 0, 0, 0, 0, 1, 1] },
  { key: 'deepbass', name: 'Deep bass', gains: [9, 8, 4, 0, -1, -1, 0, 0, 0, 0] },
  { key: 'vocal', name: 'Vocals', gains: [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0] },
  { key: 'ghazal', name: 'Ghazal', gains: [1, 1, 2, 2, 1, 2, 3, 2, 0, -1] },
  { key: 'classical', name: 'Classical', gains: [0, 0, 0, 0, 0, 0, -2, -2, -2, -3] },
  { key: 'warm', name: 'Old-school warm', gains: [3, 3, 2, 1, 0, -1, -2, -3, -4, -5] },
  { key: 'party', name: 'Party', gains: [6, 5, 3, 0, -1, 0, 2, 3, 4, 4] },
  { key: 'dj', name: 'DJ bass', gains: [9, 8, 6, 2, -1, 0, 1, 3, 4, 4] },
  { key: 'car', name: 'Long drive', gains: [5, 4, 2, 0, 0, 1, 2, 2, 3, 3] },
  { key: 'headphones', name: 'Headphones', gains: [4, 3, 1, 0, -1, 0, 1, 2, 3, 2] },
  { key: 'speaker', name: 'Phone speaker', gains: [-6, -4, 0, 3, 3, 2, 2, 2, 1, 0] },
  { key: 'night', name: 'Late night', gains: [-2, -1, 0, 1, 2, 2, 1, 0, -2, -4] },
  { key: 'treble', name: 'Crisp', gains: [-1, -1, 0, 0, 0, 1, 2, 4, 5, 6] },
];

export const EQ_CUSTOM = 'custom';

/** "Space": a touch of reverb, like hearing the song in a room. */
export const SPACES = [
  { key: 'off', name: 'Off', seconds: 0, wet: 0 },
  { key: 'room', name: 'Room', seconds: 0.8, wet: 0.18 },
  { key: 'hall', name: 'Concert hall', seconds: 2.2, wet: 0.26 },
  { key: 'stadium', name: 'Stadium', seconds: 4, wet: 0.32 },
] as const;
export type SpaceKey = (typeof SPACES)[number]['key'];

export const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5];

/** A sound setting the listener saved under their own name. */
export interface MySoundPreset { name: string; gains: number[]; bass: number; treble: number; }

export interface SavedSettings {
  accent: string;
  sky: string;
  lights: boolean;
  eqPreset: string;
  eqGains: number[];
  /** Extra bass, 0…12 dB */
  bass: number;
  /** Treble, -6…+6 dB */
  treble: number;
  /** Volume boost for quiet uploads and small phone speakers, 0…9 dB (a limiter stops crackling) */
  boost: number;
  /** Stereo width: 0 = mono, 100 = normal, 200 = extra wide */
  width: number;
  /** Left/right balance, -100…100 */
  balance: number;
  /** The song slowly circles around your head (best with headphones) */
  eightD: boolean;
  space: SpaceKey;
  speed: number;
  myPresets: MySoundPreset[];
  /** Add extra bass automatically while a High Bass DJ playlist plays */
  djBass: boolean;
  evenLoudness: boolean;
  fadeSeconds: number;
  wifiOnly: boolean;
  autoDownloadLiked: boolean;
}

const KEY = 'cfm.settings';
const DEFAULTS: SavedSettings = {
  accent: 'rose', sky: 'dusk', lights: true,
  eqPreset: 'flat', eqGains: FLAT, bass: 0, treble: 0, boost: 0, width: 100, balance: 0, eightD: false, space: 'off', speed: 1, myPresets: [], djBass: true,
  evenLoudness: false, fadeSeconds: 0,
  wifiOnly: true, autoDownloadLiked: false,
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly storage = inject(StorageService);
  private readonly saved = signal<SavedSettings>(upgrade({ ...DEFAULTS, ...this.storage.get<Partial<SavedSettings>>(KEY, {}) }));

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
  readonly bass = computed(() => this.saved().bass);
  readonly treble = computed(() => this.saved().treble);
  readonly boost = computed(() => this.saved().boost);
  readonly width = computed(() => this.saved().width);
  readonly balance = computed(() => this.saved().balance);
  readonly eightD = computed(() => this.saved().eightD);
  readonly space = computed(() => this.saved().space);
  readonly speed = computed(() => this.saved().speed);
  readonly myPresets = computed(() => this.saved().myPresets);
  readonly djBass = computed(() => this.saved().djBass);
  /** Any sound effect is on, so sound goes through Web Audio. (Speed doesn't need it.) */
  readonly needsAudioEffects = computed(() => {
    const s = this.saved();
    return s.evenLoudness || s.eqGains.some(g => g !== 0) || !!s.bass || !!s.treble || !!s.boost
      || s.width !== 100 || !!s.balance || s.eightD || s.space !== 'off';
  });

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
  setBass(db: number): void { this.update({ bass: db }); }
  setTreble(db: number): void { this.update({ treble: db }); }
  setBoost(db: number): void { this.update({ boost: db }); }
  setWidth(percent: number): void { this.update({ width: percent }); }
  setBalance(value: number): void { this.update({ balance: value }); }
  setEightD(on: boolean): void { this.update({ eightD: on }); }
  setSpace(key: SpaceKey): void { this.update({ space: key }); }
  setSpeed(speed: number): void { this.update({ speed }); }
  setDjBass(on: boolean): void { this.update({ djBass: on }); }

  /** Saves the current equaliser + bass + treble under a name (shown with the presets). */
  saveMyPreset(name: string): void {
    const s = this.saved();
    const preset: MySoundPreset = { name: name.trim().slice(0, 24) || `My sound ${s.myPresets.length + 1}`, gains: [...s.eqGains], bass: s.bass, treble: s.treble };
    this.update({ myPresets: [...s.myPresets.filter(p => p.name !== preset.name), preset], eqPreset: 'my:' + preset.name });
  }

  applyMyPreset(name: string): void {
    const p = this.saved().myPresets.find(x => x.name === name);
    if (p) this.update({ eqGains: [...p.gains], bass: p.bass, treble: p.treble, eqPreset: 'my:' + p.name });
  }

  deleteMyPreset(name: string): void {
    const s = this.saved();
    this.update({ myPresets: s.myPresets.filter(p => p.name !== name), eqPreset: s.eqPreset === 'my:' + name ? EQ_CUSTOM : s.eqPreset });
  }

  /** Every sound setting back to normal (keeps saved presets). */
  resetSound(): void {
    const { eqPreset, eqGains, bass, treble, boost, width, balance, eightD, space, speed, evenLoudness } = DEFAULTS;
    this.update({ eqPreset, eqGains, bass, treble, boost, width, balance, eightD, space, speed, evenLoudness });
  }

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
    this.saved.set(upgrade({ ...DEFAULTS, ...this.saved(), ...saved }));
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

/** Settings saved by older versions (5-band equaliser) start from a flat 10-band one. */
function upgrade(s: SavedSettings): SavedSettings {
  if (s.eqGains?.length !== EQ_BANDS.length) return { ...s, eqGains: [...FLAT], eqPreset: 'flat' };
  return s;
}

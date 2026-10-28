import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { WEBSITE_URL } from '../data/app-info';
import { LATEST_VERSION, LatestFile, LatestTrack } from '../models/latest.model';
import { LibraryService } from './library.service';
import { PlayerService } from './player.service';
import { SpotifyService } from './spotify.service';
import { ToastService } from './toast.service';

export type LatestTab = 'new' | 'trending' | 'charts' | 'spotify';

export const LATEST_TABS: Array<{ key: LatestTab; name: string; note: string }> = [
  { key: 'new', name: 'New this month', note: 'Full songs from official label channels on YouTube' },
  { key: 'trending', name: 'Trending now', note: "India's trending music on YouTube today" },
  { key: 'charts', name: 'Top 100 India', note: "Apple Music's most played in India · 30-sec previews" },
  { key: 'spotify', name: 'Spotify', note: "This year's hits on Spotify" },
];

/**
 * "Latest & Trending": loads latest.json (made daily by scripts/build-latest.ts) and plays
 * 30-second previews. Full YouTube songs play in the visible YouTube player (latest-panel).
 */
@Injectable({ providedIn: 'root' })
export class LatestService {
  private readonly library = inject(LibraryService);
  private readonly player = inject(PlayerService);
  private readonly spotify = inject(SpotifyService);
  private readonly toast = inject(ToastService);

  readonly file = signal<LatestFile | null>(null);
  readonly loading = signal(false);
  readonly tab = signal<LatestTab>('new');
  /** Spotify songs found live for the connected listener (when latest.json has none). */
  private readonly liveSpotify = signal<Record<string, LatestTrack[]>>({});

  /** The 30-second preview playing now (track id), if any. */
  readonly previewing = signal<string | null>(null);
  readonly previewProgress = signal(0);
  private readonly preview = typeof Audio === 'undefined' ? null : new Audio();
  private loaded = false;

  readonly list = computed<LatestTrack[]>(() => {
    const f = this.file();
    const lang = this.library.language().code;
    switch (this.tab()) {
      case 'new': return f?.youtubeNew[lang] ?? [];
      case 'trending': return f?.youtubeTrending ?? [];
      case 'charts': return f?.appleTop ?? [];
      case 'spotify': return f?.spotifyNew[lang]?.length ? f.spotifyNew[lang] : (this.liveSpotify()[lang] ?? []);
    }
  });

  readonly updated = computed(() => {
    const at = this.file()?.generatedAt;
    if (!at) return '';
    const hours = Math.round((Date.now() - Date.parse(at)) / 36e5);
    return hours < 1 ? 'Updated just now' : hours < 24 ? `Updated ${hours} h ago` : `Updated ${Math.round(hours / 24)} days ago`;
  });

  constructor() {
    if (!this.preview) return;
    this.preview.addEventListener('timeupdate', () => this.previewProgress.set(this.preview!.currentTime / (this.preview!.duration || 30)));
    this.preview.addEventListener('ended', () => this.previewing.set(null));
    this.preview.addEventListener('error', () => { this.previewing.set(null); this.toast.show("This preview can't play"); });
    // The main player started again: stop the preview.
    effect(() => { if (this.player.isPlaying()) this.stopPreview(); });
    // Spotify tab with nothing prebuilt: search live for the connected listener.
    effect(() => {
      const lang = this.library.language().code;
      if (this.tab() !== 'spotify' || !this.spotify.connected() || this.file()?.spotifyNew[lang]?.length || this.liveSpotify()[lang]) return;
      this.liveSpotify.update(m => ({ ...m, [lang]: [] }));
      this.spotify.api.newForLanguage(lang, 30)
        .then(list => this.liveSpotify.update(m => ({ ...m, [lang]: list })))
        .catch(() => undefined);
    });
  }

  /** Fetches latest.json once (the app tries the live website first, for the newest list). */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.loading.set(true);
    const read = async (url: string, ms?: number) => {
      const abort = new AbortController();
      const timer = ms ? setTimeout(() => abort.abort(), ms) : undefined;
      try {
        const res = await fetch(url, { cache: 'no-cache', signal: abort.signal });
        const json = res.ok ? ((await res.json()) as LatestFile) : null;
        return json?.version === LATEST_VERSION ? json : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    let file: LatestFile | null = null;
    if (Capacitor.isNativePlatform() && navigator.onLine) file = await read(`${WEBSITE_URL}latest.json`, 6000);
    file ??= await read('latest.json');
    this.file.set(file);
    this.loading.set(false);
    // Open on the first tab that has songs.
    if (file && !this.list().length) {
      const lang = this.library.language().code;
      if (file.youtubeTrending.length && !file.youtubeNew[lang]?.length) this.tab.set('trending');
      if (!file.youtubeTrending.length && file.appleTop.length) this.tab.set('charts');
    }
  }

  togglePreview(track: LatestTrack): void {
    if (!this.preview || !track.previewUrl) return;
    if (this.previewing() === track.id) { this.stopPreview(); return; }
    this.player.pause();
    this.spotify.pause();
    this.preview.src = track.previewUrl;
    this.preview.play().then(() => this.previewing.set(track.id)).catch(() => this.toast.show("This preview can't play"));
  }

  stopPreview(): void {
    this.preview?.pause();
    this.previewing.set(null);
    this.previewProgress.set(0);
  }
}

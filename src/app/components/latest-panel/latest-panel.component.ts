import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { LatestTrack } from '../../models/latest.model';
import { LATEST_TABS, LatestService, LatestTab } from '../../services/latest.service';
import { LibraryService } from '../../services/library.service';
import { NativeService } from '../../services/native.service';
import { PlayerService } from '../../services/player.service';
import { SpotifyPlaylistObject } from '../../services/spotify-api';
import { SpotifyService, openExternal } from '../../services/spotify.service';
import { ToastService } from '../../services/toast.service';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../icon/icon.component';

/* Minimal typing of the YouTube IFrame Player API. */
interface YtPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: { Player: new (el: HTMLElement, o: object) => YtPlayer; PlayerState: { ENDED: number; PLAYING: number } };
  }
}

type SpotifyView = 'hits' | 'liked' | 'playlists' | 'search';

/**
 * "Latest & Trending": new songs and charts, full screen.
 * YouTube songs play in full in the YouTube player shown at the top (YouTube's rules: the video
 * stays visible and stops when this screen closes or the app goes to the background).
 */
@Component({
  selector: 'app-latest-panel',
  imports: [IconComponent],
  templateUrl: './latest-panel.component.html',
  styleUrl: './latest-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()', '(document:visibilitychange)': 'onVisibility()' },
})
export class LatestPanelComponent {
  protected readonly ui = inject(UiService);
  protected readonly latest = inject(LatestService);
  protected readonly library = inject(LibraryService);
  protected readonly spotify = inject(SpotifyService);
  private readonly native = inject(NativeService);
  private readonly player = inject(PlayerService);
  private readonly toast = inject(ToastService);
  private readonly ytBox = viewChild<ElementRef<HTMLElement>>('yt');

  protected readonly tabs = computed(() => LATEST_TABS.filter(t => t.key !== 'spotify' || this.spotify.available || !!this.latest.file()?.spotifyNew[this.library.language().code]?.length));
  protected readonly note = computed(() => LATEST_TABS.find(t => t.key === this.latest.tab())!.note);

  // ---- YouTube player
  protected readonly queue = signal<LatestTrack[]>([]);
  protected readonly index = signal(0);
  protected readonly video = computed(() => this.queue()[this.index()] ?? null);
  private yt?: YtPlayer;
  private ytReady?: Promise<void>;

  // ---- Spotify tab
  protected readonly spotifyView = signal<SpotifyView>('hits');
  protected readonly spotifyResults = signal<LatestTrack[]>([]);
  protected readonly openPlaylist = signal<{ playlist: SpotifyPlaylistObject; tracks: LatestTrack[] } | null>(null);
  protected readonly spotifyBusy = signal(false);
  private lastQuery = '';

  /** The songs shown right now. */
  protected readonly rows = computed<LatestTrack[]>(() => {
    if (this.latest.tab() !== 'spotify') return this.latest.list();
    switch (this.spotifyView()) {
      case 'hits': return this.latest.list();
      case 'liked': return this.spotify.liked();
      case 'search': return this.spotifyResults();
      case 'playlists': return this.openPlaylist()?.tracks ?? [];
    }
  });

  constructor() {
    effect(() => { if (this.ui.latestOpen()) this.latest.load(); });
    // Closing the screen stops YouTube (no background play) and any preview.
    effect(() => { if (!this.ui.latestOpen()) this.stopVideo(); });
  }

  close(): void {
    this.ui.latestOpen.set(false);
    this.latest.stopPreview();
  }

  protected setTab(tab: LatestTab): void {
    this.latest.tab.set(tab);
  }

  protected openLanguages(): void {
    this.ui.languageOpen.set(true);
  }

  // ---- what a tap on a row does -----------------------------------------------------

  protected play(track: LatestTrack, i: number): void {
    if (track.youtubeId) this.playVideo(this.rows().filter(t => t.youtubeId), this.rows().filter(t => t.youtubeId).indexOf(track));
    else if (track.spotifyUri) this.spotify.play(this.rows(), i);
    else if (track.previewUrl) this.latest.togglePreview(track);
    else this.openOutside(track);
  }

  protected openOutside(track: LatestTrack): void {
    const url = track.youtubeId ? `https://www.youtube.com/watch?v=${track.youtubeId}` : track.spotifyUrl ?? track.appleUrl;
    if (url) openExternal(url, this.native.isApp);
  }

  protected outsideLabel(track: LatestTrack): string {
    return track.youtubeId ? 'Open in YouTube' : track.spotifyUri ? 'Open in Spotify' : 'Open in Apple Music';
  }

  // ---- YouTube ----------------------------------------------------------------------

  protected playAllVideos(): void {
    const videos = this.rows().filter(t => t.youtubeId);
    if (videos.length) this.playVideo(videos, 0);
  }

  protected async playVideo(list: LatestTrack[], at: number): Promise<void> {
    this.queue.set(list);
    this.index.set(Math.max(0, at));
    this.player.pause();
    this.latest.stopPreview();
    this.spotify.pause();
    await this.ensureYt();
    const id = this.video()?.youtubeId;
    if (id && this.yt) this.yt.loadVideoById(id);
    document.querySelector('.latest .body')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected step(by: 1 | -1): void {
    const n = this.queue().length;
    if (!n) return;
    this.index.set((this.index() + by + n) % n);
    const id = this.video()?.youtubeId;
    if (id) this.yt?.loadVideoById(id);
  }

  protected stopVideo(): void {
    this.yt?.destroy();
    this.yt = undefined;
    this.ytReady = undefined;
    this.queue.set([]);
  }

  protected onVisibility(): void {
    if (document.hidden) this.yt?.pauseVideo(); // YouTube may not play in the background
  }

  private ensureYt(): Promise<void> {
    if (this.ytReady) return this.ytReady;
    this.ytReady = new Promise<void>(resolve => {
      const create = () => {
        const host = this.ytBox()?.nativeElement;
        if (!host || !window.YT) { resolve(); return; }
        const mount = document.createElement('div');
        host.replaceChildren(mount);
        this.yt = new window.YT.Player(mount, {
          width: '100%', height: '100%', videoId: this.video()?.youtubeId,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
          events: {
            onReady: () => resolve(),
            onStateChange: (e: { data: number }) => {
              if (e.data === window.YT!.PlayerState.ENDED) this.step(1);
              if (e.data === window.YT!.PlayerState.PLAYING) { this.player.pause(); this.latest.stopPreview(); }
            },
            onError: () => {
              this.toast.show("The label doesn't allow this one in apps. Skipping…", 2600);
              setTimeout(() => this.step(1), 900);
            },
          },
        });
      };
      if (window.YT?.Player) { create(); return; }
      window.onYouTubeIframeAPIReady = create;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    });
    return this.ytReady;
  }

  // ---- Spotify ------------------------------------------------------------------------

  protected async setSpotifyView(view: SpotifyView): Promise<void> {
    this.spotifyView.set(view);
    this.openPlaylist.set(null);
    if (view === 'liked' && !this.spotify.liked().length) await this.spotify.loadLiked().catch(() => this.toast.show("Couldn't load your Spotify songs"));
    if (view === 'playlists' && !this.spotify.playlists().length) await this.spotify.loadPlaylists().catch(() => undefined);
  }

  protected async searchSpotify(query: string): Promise<void> {
    if (!query.trim()) return;
    this.lastQuery = query.trim();
    this.spotifyBusy.set(true);
    try {
      this.spotifyResults.set(await this.spotify.search(query.trim()));
    } catch {
      this.toast.show("Couldn't search Spotify right now");
    } finally {
      this.spotifyBusy.set(false);
    }
  }

  protected async moreSpotify(): Promise<void> {
    this.spotifyBusy.set(true);
    try {
      const more = await this.spotify.search(this.lastQuery, this.spotifyResults().length);
      this.spotifyResults.update(list => [...list, ...more.filter(m => !list.some(t => t.id === m.id))]);
    } finally {
      this.spotifyBusy.set(false);
    }
  }

  protected async showPlaylist(p: SpotifyPlaylistObject): Promise<void> {
    this.spotifyBusy.set(true);
    try {
      this.openPlaylist.set({ playlist: p, tracks: await this.spotify.playlistTracks(p.id) });
    } catch {
      this.toast.show('Spotify only shares songs of playlists you made. Opening it in Spotify…', 3200);
      if (p.external_urls?.spotify) openExternal(p.external_urls.spotify, this.native.isApp);
    } finally {
      this.spotifyBusy.set(false);
    }
  }

  protected playlistCount(p: SpotifyPlaylistObject): number {
    return p.items?.total ?? p.tracks?.total ?? 0;
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

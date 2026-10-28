import { Injectable, computed, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';

import { SPOTIFY_APP_REDIRECT, SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES } from '../data/spotify-config';
import { LatestTrack } from '../models/latest.model';
import { NativeService } from './native.service';
import { SpotifyApi, SpotifyError, SpotifyPage, SpotifyPlaylistObject, SpotifyTrackObject, toLatest } from './spotify-api';
import { StorageService } from './storage.service';
import { ToastService } from './toast.service';

const KEY_TOKENS = 'cfm.spotify.tokens';
const KEY_PKCE = 'cfm.spotify.pkce';

interface Tokens { access: string; refresh: string; expiresAt: number; }
interface Pkce { verifier: string; state: string; redirect: string; }

/* Minimal typing of Spotify's Web Playback SDK (desktop browsers, Premium). */
interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  pause(): Promise<void>;
  addListener(event: string, cb: (data: { device_id?: string; message?: string }) => void): void;
}
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: { Player: new (o: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume?: number }) => SdkPlayer };
  }
}

/**
 * "Connect Spotify": the listener's own Spotify account, inside Cassette.fm.
 *
 *  - search Spotify, see your Spotify liked songs and playlists, save songs to Spotify
 *  - play full songs: on a computer right here (Web Playback SDK), on a phone through the
 *    Spotify app (Spotify Connect). Both need Spotify Premium; otherwise songs open in Spotify.
 *
 * Spotify's 2026 rules: an app in Development Mode can be used by at most 5 Spotify accounts,
 * each added by hand in the Spotify dashboard (see SPOTIFY.md).
 */
@Injectable({ providedIn: 'root' })
export class SpotifyService {
  private readonly native = inject(NativeService);
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  /** A Client ID is set up, so "Connect Spotify" can be offered. */
  readonly available = !!SPOTIFY_CLIENT_ID;
  private readonly tokens = signal<Tokens | null>(this.storage.get<Tokens | null>(KEY_TOKENS, null));
  readonly connected = computed(() => !!this.tokens());
  readonly name = signal('');
  readonly liked = signal<LatestTrack[]>([]);
  readonly playlists = signal<SpotifyPlaylistObject[]>([]);
  readonly busy = signal(false);
  /** The song last started on Spotify. */
  readonly nowPlaying = signal<LatestTrack | null>(null);

  readonly api = new SpotifyApi(() => this.accessToken());
  private sdk?: SdkPlayer;
  private sdkDevice: string | null = null;
  private refreshing?: Promise<string | null>;

  constructor() {
    if (typeof window === 'undefined' || !this.available) return;
    this.listenForCallback();
    if (this.connected()) this.afterConnect();
  }

  // ---- connect / disconnect ---------------------------------------------------

  /** Opens Spotify's log-in page. The listener comes back to the app (or site) afterwards. */
  async connect(): Promise<void> {
    if (!this.available) return;
    const verifier = randomText(64);
    const state = randomText(16);
    const redirect = this.redirectUri();
    this.storage.set(KEY_PKCE, { verifier, state, redirect } satisfies Pkce);
    const challenge = await sha256base64url(verifier);
    const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirect, scope: SPOTIFY_SCOPES,
      code_challenge_method: 'S256', code_challenge: challenge, state,
    });
    // In the app this leaves the WebView and opens the browser (or the Spotify app).
    location.href = url;
  }

  disconnect(): void {
    this.sdk?.disconnect();
    this.sdk = undefined;
    this.sdkDevice = null;
    this.tokens.set(null);
    this.storage.remove(KEY_TOKENS);
    this.liked.set([]);
    this.playlists.set([]);
    this.name.set('');
    this.toast.show('Spotify disconnected');
  }

  // ---- library -------------------------------------------------------------------

  async search(query: string, offset = 0): Promise<LatestTrack[]> {
    return (await this.api.searchTracks(query, offset)).map(toLatest);
  }

  async loadLiked(): Promise<void> {
    const page = await this.api.call<SpotifyPage<{ track?: SpotifyTrackObject; item?: SpotifyTrackObject }>>('/me/tracks?limit=50');
    this.liked.set(page.items.map(i => i.item ?? i.track).filter((t): t is SpotifyTrackObject => !!t?.id).map(toLatest));
  }

  async loadPlaylists(): Promise<void> {
    const page = await this.api.call<SpotifyPage<SpotifyPlaylistObject>>('/me/playlists?limit=50');
    this.playlists.set(page.items.filter(Boolean));
  }

  /** Songs of a playlist. Spotify only shows songs of playlists you own or collaborate on. */
  async playlistTracks(id: string): Promise<LatestTrack[]> {
    const page = await this.api.call<SpotifyPage<{ item?: SpotifyTrackObject; track?: SpotifyTrackObject }>>(`/playlists/${id}/items?limit=50`);
    return page.items.map(i => i.item ?? i.track).filter((t): t is SpotifyTrackObject => !!t?.id).map(toLatest);
  }

  /** Saves a song to the listener's Spotify library ("Liked Songs" in Spotify). */
  async save(track: LatestTrack): Promise<void> {
    if (!track.spotifyUri) return;
    await this.api.call(`/me/library?uris=${encodeURIComponent(track.spotifyUri)}`, { method: 'PUT' });
    this.toast.show('Saved to your Spotify library');
    this.liked.update(list => (list.some(t => t.id === track.id) ? list : [track, ...list]));
  }

  // ---- playing ---------------------------------------------------------------------

  /**
   * Plays songs on Spotify, starting with `start`. Order of tries:
   *  1. this browser (computer, Premium)  2. any Spotify app that's open (phone, Premium)
   *  3. opens the song in Spotify, where the listener taps play.
   */
  async play(list: LatestTrack[], start = 0): Promise<void> {
    const uris = list.map(t => t.spotifyUri).filter((u): u is string => !!u).slice(start, start + 50);
    const first = list[start];
    if (!first?.spotifyUri) return;
    if (!this.connected()) { this.open(first); return; }
    this.nowPlaying.set(first);
    try {
      const device = this.sdkDevice ?? (await this.pickDevice());
      if (!device) { this.open(first); return; }
      await this.api.call(`/me/player/play?device_id=${device}`, { method: 'PUT', body: JSON.stringify({ uris }) });
      this.toast.show(this.sdkDevice ? 'Playing on Spotify ♪' : 'Playing in your Spotify app ♪');
    } catch (err) {
      const e = err as SpotifyError;
      if (e.status === 403) this.toast.show('Full songs need Spotify Premium. Opening it in Spotify…', 3200);
      this.open(first);
    }
  }

  async pause(): Promise<void> {
    if (this.sdk) { await this.sdk.pause().catch(() => undefined); return; }
    if (this.connected() && this.nowPlaying()) await this.api.call('/me/player/pause', { method: 'PUT' }).catch(() => undefined);
  }

  /** Opens the song in the Spotify app (phones) or Spotify's web player. */
  open(track: LatestTrack): void {
    const url = track.spotifyUrl ?? (track.spotifyUri ? `https://open.spotify.com/track/${track.spotifyUri.split(':').pop()}` : '');
    if (url) openExternal(url, this.native.isApp);
  }

  // ---- private -----------------------------------------------------------------------

  private redirectUri(): string {
    return this.native.isApp ? SPOTIFY_APP_REDIRECT : location.origin + location.pathname;
  }

  private async afterConnect(): Promise<void> {
    try {
      const me = await this.api.call<{ display_name?: string; id: string }>('/me');
      this.name.set(me.display_name || me.id);
      this.loadLiked().catch(() => undefined);
      this.loadPlaylists().catch(() => undefined);
      this.startSdk();
    } catch (err) {
      const e = err as SpotifyError;
      if (e.status === 403) {
        // Development Mode: this Spotify account isn't on the app's user list.
        this.toast.show('This Spotify account isn’t allowed yet. Ask the app owner to add you (max 5 users).', 4500);
        this.disconnect();
      }
    }
  }

  /** Finds a device to play on: the active one, else any Spotify app that's open. */
  private async pickDevice(): Promise<string | null> {
    const res = await this.api.call<{ devices: Array<{ id: string; is_active: boolean; is_restricted: boolean }> }>('/me/player/devices');
    const usable = (res.devices ?? []).filter(d => !d.is_restricted);
    return (usable.find(d => d.is_active) ?? usable[0])?.id ?? null;
  }

  /** Spotify's in-browser player: computers only (it doesn't run in phone browsers or the app). */
  private startSdk(): void {
    if (this.native.isApp || this.sdk || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return;
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (!window.Spotify) return;
      const player = new window.Spotify.Player({
        name: 'Cassette.fm', volume: 0.8,
        getOAuthToken: cb => { this.accessToken().then(t => t && cb(t)); },
      });
      player.addListener('ready', ({ device_id }) => { this.sdkDevice = device_id ?? null; });
      player.addListener('not_ready', () => { this.sdkDevice = null; });
      player.addListener('account_error', () => { this.sdkDevice = null; }); // not Premium: fall back to opening Spotify
      player.connect();
      this.sdk = player;
    };
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.head.appendChild(script);
  }

  /** Website: ?code=… in the address after Spotify. App: cassettefm://spotify-callback?code=… */
  private listenForCallback(): void {
    const handle = (url: string) => {
      const u = new URL(url);
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      const error = u.searchParams.get('error');
      if (!code && !error) return;
      if (!this.native.isApp) history.replaceState(null, '', location.pathname); // tidy the address bar
      if (error) { this.toast.show(error === 'access_denied' ? 'Spotify connection cancelled' : 'Spotify said no. Try again.'); return; }
      this.finishConnect(code!, state).catch(() => this.toast.show("Couldn't connect Spotify. Try again."));
    };
    if (this.native.isApp) {
      App.addListener('appUrlOpen', ({ url }) => { if (url.startsWith(SPOTIFY_APP_REDIRECT)) handle(url); }).catch(() => undefined);
      App.getLaunchUrl().then(r => { if (r?.url?.startsWith(SPOTIFY_APP_REDIRECT)) handle(r.url); }).catch(() => undefined);
    } else if (location.search.includes('code=') || location.search.includes('error=')) {
      handle(location.href);
    }
  }

  private async finishConnect(code: string, state: string | null): Promise<void> {
    const pkce = this.storage.get<Pkce | null>(KEY_PKCE, null);
    if (!pkce || pkce.state !== state) return;
    this.storage.remove(KEY_PKCE);
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: pkce.redirect, client_id: SPOTIFY_CLIENT_ID, code_verifier: pkce.verifier }),
    });
    if (!res.ok) throw new Error('token');
    this.saveTokens(await res.json());
    this.toast.show('Spotify connected ✓');
    await this.afterConnect();
  }

  private saveTokens(t: { access_token: string; refresh_token?: string; expires_in: number }): void {
    const tokens: Tokens = { access: t.access_token, refresh: t.refresh_token ?? this.tokens()?.refresh ?? '', expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
    this.tokens.set(tokens);
    this.storage.set(KEY_TOKENS, tokens);
  }

  /** A valid access token, refreshed when it's about to run out. */
  private accessToken(): Promise<string | null> {
    const t = this.tokens();
    if (!t) return Promise.resolve(null);
    if (Date.now() < t.expiresAt) return Promise.resolve(t.access);
    this.refreshing ??= fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: SPOTIFY_CLIENT_ID }),
    })
      .then(async res => {
        if (!res.ok) { this.disconnect(); return null; }
        this.saveTokens(await res.json());
        return this.tokens()?.access ?? null;
      })
      .catch(() => null)
      .finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
}

/** Opens a link outside the app: the Spotify / YouTube app if installed, otherwise the browser. */
export function openExternal(url: string, isApp: boolean): void {
  if (isApp) location.href = url; // Capacitor hands non-app links to Android
  else window.open(url, '_blank', 'noopener');
}

function randomText(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(b => chars[b % chars.length]).join('');
}

async function sha256base64url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

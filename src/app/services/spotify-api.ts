/*
 * A small Spotify Web API client with no Angular in it, so the website, the Android app
 * and scripts/build-latest.ts all share it.
 *
 * Written for Spotify's 2026 rules for Development Mode apps: search returns at most
 * 10 results per page, playlist songs come from /items, saving goes through /me/library,
 * and New Releases / Top Tracks no longer exist (so "new songs" are found by searching
 * this year's songs per genre).
 */
import { LatestTrack } from '../models/latest.model';

export const SPOTIFY_API = 'https://api.spotify.com/v1';

/** Spotify genres used to find each language's new songs (the "genre:" search filter). */
export const SPOTIFY_GENRES: Record<string, string[]> = {
  hi: ['filmi', 'modern bollywood', 'desi pop'],
  en: ['soundtrack', 'movie tunes'],
  ta: ['tamil pop', 'kollywood'],
  te: ['telugu pop', 'tollywood'],
  kn: ['kannada pop', 'sandalwood'],
  ml: ['malayalam pop', 'mollywood'],
  bn: ['bengali pop'],
  mr: ['marathi pop'],
  pa: ['punjabi pop', 'punjabi hip hop'],
  gu: ['gujarati pop'],
  or: ['odia pop'],
  as: ['assamese pop'],
  bho: ['bhojpuri pop'],
  hry: ['haryanvi pop', 'haryanvi hip hop'],
  raj: ['rajasthani pop', 'rajasthani folk'],
  gbm: ['garhwali pop'],
  kfy: ['kumaoni pop'],
  kok: ['konkani pop'],
  tcy: ['tulu pop'],
  mai: ['maithili pop'],
  doi: ['dogri pop'],
};

export interface SpotifyTrackObject {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: Array<{ name: string }>;
  album: { name: string; release_date?: string; images: Array<{ url: string; width?: number }> };
  external_urls?: { spotify?: string };
}

export interface SpotifyPlaylistObject {
  id: string;
  uri: string;
  name: string;
  owner?: { id: string; display_name?: string };
  images?: Array<{ url: string }> | null;
  items?: { total: number };
  tracks?: { total: number };
  external_urls?: { spotify?: string };
}

export interface SpotifyPage<T> { items: T[]; total: number; next: string | null; offset: number; }

export class SpotifyError extends Error {
  constructor(readonly status: number, readonly reason: string, message: string) { super(message); }
}

/** Turns a Spotify track into the app's LatestTrack shape. */
export function toLatest(t: SpotifyTrackObject): LatestTrack {
  const images = t.album?.images ?? [];
  return {
    id: 'sp:' + t.id,
    title: t.name,
    artist: (t.artists ?? []).map(a => a.name).join(', '),
    cover: (images.find(i => (i.width ?? 0) <= 320) ?? images[0])?.url ?? '',
    spotifyUri: t.uri,
    spotifyUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    released: t.album?.release_date,
  };
}

/**
 * Calls the API with a token from `getToken`. Retries once after a 429 (rate limit),
 * waiting as long as Spotify asks.
 */
export class SpotifyApi {
  constructor(private readonly getToken: () => Promise<string | null>) {}

  async call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await this.getToken();
    if (!token) throw new SpotifyError(401, 'NO_TOKEN', 'Not connected to Spotify');
    const res = await fetch(path.startsWith('http') ? path : SPOTIFY_API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 429 && retry) {
      const body = await res.clone().json().catch(() => null) as { reason?: string } | null;
      if (body?.reason === 'QUOTA_EXCEEDED') throw new SpotifyError(429, 'QUOTA_EXCEEDED', 'Spotify daily quota used up');
      const wait = Math.min(30, Number(res.headers.get('Retry-After') ?? 2));
      await new Promise(r => setTimeout(r, wait * 1000));
      return this.call<T>(path, init, false);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: { message?: string; reason?: string } } | null;
      throw new SpotifyError(res.status, body?.error?.reason ?? '', body?.error?.message ?? `Spotify error ${res.status}`);
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Songs matching `query`. Spotify gives 10 per page now; `offset` pages through. */
  async searchTracks(query: string, offset = 0, market = 'IN'): Promise<SpotifyTrackObject[]> {
    const q = new URLSearchParams({ q: query, type: 'track', limit: '10', offset: String(offset), market });
    const res = await this.call<{ tracks?: SpotifyPage<SpotifyTrackObject> }>(`/search?${q}`);
    return (res.tracks?.items ?? []).filter(Boolean);
  }

  /** This year's songs for a language (falls back to last year if there are few). Up to `max` songs. */
  async newForLanguage(code: string, max = 40): Promise<LatestTrack[]> {
    const genres = SPOTIFY_GENRES[code] ?? [];
    const year = new Date().getFullYear();
    const seen = new Set<string>();
    const out: LatestTrack[] = [];
    for (const y of [year, year - 1]) {
      for (const genre of genres) {
        for (let offset = 0; offset < 30 && out.length < max; offset += 10) {
          const page = await this.searchTracks(`year:${y} genre:"${genre}"`, offset).catch(() => []);
          for (const t of page) {
            const key = `${t.name}|${t.artists?.[0]?.name}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(toLatest(t));
          }
          if (page.length < 10) break;
        }
      }
      if (out.length >= max / 2) break;
    }
    return out.slice(0, max);
  }
}

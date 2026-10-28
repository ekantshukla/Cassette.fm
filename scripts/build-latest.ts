/*
 * Builds public/latest.json: the "Latest & Trending" screen.
 *
 *   npm run latest
 *
 * GitHub Actions runs it before every deploy and once a day, next to build-playlists.ts.
 * Each source is optional; whatever works is used, the rest is kept from yesterday's file.
 *
 *   Apple Music charts   always (free, no key): India's most-played songs + 30-second previews
 *   YouTube              needs the YOUTUBE_API_KEY secret: trending music + this month's new songs per language
 *   Spotify              needs SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET: this year's songs per language
 *
 * PREVIOUS_LATEST_URL (optional): the live site's latest.json, used when a source fails.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { LANGUAGES } from '../src/app/data/languages';
import { LATEST_VERSION, LatestFile, LatestTrack } from '../src/app/models/latest.model';
import { SpotifyApi } from '../src/app/services/spotify-api';

const OUTPUT = 'public/latest.json';
const env = process.env;

async function main(): Promise<void> {
  const previous = await fetchJson<LatestFile>(env['PREVIOUS_LATEST_URL']).then(f => (f?.version === LATEST_VERSION ? f : null));
  const file: LatestFile = {
    version: LATEST_VERSION,
    generatedAt: new Date().toISOString(),
    appleTop: previous?.appleTop ?? [],
    youtubeTrending: previous?.youtubeTrending ?? [],
    youtubeNew: previous?.youtubeNew ?? {},
    spotifyNew: previous?.spotifyNew ?? {},
  };

  await step('Apple Music top songs (India)', async () => {
    const top = await appleTop();
    if (top.length) file.appleTop = top;
    return top.length;
  });

  const ytKey = env['YOUTUBE_API_KEY'];
  if (ytKey) {
    await step('YouTube trending music (India)', async () => {
      const list = await youtubeTrending(ytKey);
      if (list.length) file.youtubeTrending = list;
      return list.length;
    });
    for (const lang of LANGUAGES) {
      await step(`YouTube new ${lang.name}`, async () => {
        const list = await youtubeNew(ytKey, lang.code, lang.name);
        if (list.length) file.youtubeNew[lang.code] = list;
        return list.length;
      });
    }
  } else {
    console.log('YouTube: skipped (no YOUTUBE_API_KEY secret)');
  }

  const id = env['SPOTIFY_CLIENT_ID'];
  const secret = env['SPOTIFY_CLIENT_SECRET'];
  if (id && secret) {
    const token = await spotifyAppToken(id, secret).catch(err => { console.log('Spotify token failed:', err.message); return null; });
    if (token) {
      const api = new SpotifyApi(async () => token);
      for (const lang of LANGUAGES) {
        await step(`Spotify new ${lang.name}`, async () => {
          const list = await api.newForLanguage(lang.code, 40);
          if (list.length) file.spotifyNew[lang.code] = list;
          return list.length;
        });
      }
    }
  } else {
    console.log('Spotify: skipped (no SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET secrets)');
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(file));
  console.log(`\nWrote ${OUTPUT}`);
}

// ---- Apple Music ---------------------------------------------------------------

interface AppleFeed { feed?: { results?: Array<{ id: string; name: string; artistName: string; artworkUrl100: string; url: string; releaseDate?: string }> } }
interface ItunesLookup { results?: Array<{ trackId: number; previewUrl?: string }> }

async function appleTop(): Promise<LatestTrack[]> {
  const feed = await fetchJson<AppleFeed>('https://rss.applemarketingtools.com/api/v2/in/music/most-played/100/songs.json');
  const results = feed?.feed?.results ?? [];
  // The feed has no previews; the iTunes lookup adds them (up to 50 IDs per request).
  const previews = new Map<string, string>();
  for (let i = 0; i < results.length; i += 50) {
    const ids = results.slice(i, i + 50).map(r => r.id).join(',');
    const lookup = await fetchJson<ItunesLookup>(`https://itunes.apple.com/lookup?id=${ids}&country=in&entity=song`);
    for (const r of lookup?.results ?? []) if (r.previewUrl) previews.set(String(r.trackId), r.previewUrl);
  }
  return results.map(r => ({
    id: 'ap:' + r.id, title: r.name, artist: r.artistName,
    cover: r.artworkUrl100.replace('100x100', '300x300'), appleUrl: r.url,
    previewUrl: previews.get(r.id), released: r.releaseDate,
  }));
}

// ---- YouTube ---------------------------------------------------------------------

interface YtSnippet { title: string; channelTitle: string; publishedAt: string; thumbnails: Record<string, { url: string }> }
interface YtVideos { items?: Array<{ id: string; snippet: YtSnippet }> }
interface YtSearch { items?: Array<{ id: { videoId?: string }; snippet: YtSnippet }> }

const YT = 'https://www.googleapis.com/youtube/v3';
/** Words that mark something that isn't one song. */
const NOT_A_SONG = /#shorts|jukebox|non ?stop|full album|audio jukebox|trailer|teaser|reaction|lyrics? video compilation|\blive\b|mashup|\bmix\b/i;

function ytTrack(id: string, s: YtSnippet): LatestTrack {
  const title = decode(s.title);
  // Labels write "Song Name | Film | Singer | Label" or "Song Name - Film": the first part is the song.
  const [song, ...rest] = title.split(/\s[|｜]\s|\s[-–]\s/);
  return {
    id: 'yt:' + id,
    title: song.replace(/\((official )?(full )?(video|audio|song)\)|\[.*?\]|official (music )?video/gi, '').trim() || title,
    artist: rest.find(p => !/t-series|saregama|sony|zee|tips|speed records|aditya|lahari|think music|official/i.test(p))?.trim() || s.channelTitle,
    cover: (s.thumbnails['high'] ?? s.thumbnails['medium'] ?? s.thumbnails['default'])?.url ?? '',
    youtubeId: id,
    released: s.publishedAt.slice(0, 10),
  };
}

async function youtubeTrending(key: string): Promise<LatestTrack[]> {
  const res = await fetchJson<YtVideos>(`${YT}/videos?part=snippet&chart=mostPopular&regionCode=IN&videoCategoryId=10&maxResults=50&key=${key}`);
  return (res?.items ?? []).filter(v => !NOT_A_SONG.test(v.snippet.title)).map(v => ytTrack(v.id, v.snippet));
}

/** The most-watched new songs of the last 30 days in one language. (100 quota units per call.) */
async function youtubeNew(key: string, code: string, name: string): Promise<LatestTrack[]> {
  const after = new Date(Date.now() - 30 * 864e5).toISOString();
  const q = new URLSearchParams({
    part: 'snippet', type: 'video', videoCategoryId: '10', regionCode: 'IN', order: 'viewCount', maxResults: '30',
    publishedAfter: after, q: `${name} song`, relevanceLanguage: code === 'bho' ? 'hi' : code, videoEmbeddable: 'true', key,
  });
  const res = await fetchJson<YtSearch>(`${YT}/search?${q}`);
  return (res?.items ?? [])
    .filter(v => v.id.videoId && !NOT_A_SONG.test(v.snippet.title))
    .map(v => ytTrack(v.id.videoId!, v.snippet));
}

// ---- Spotify ---------------------------------------------------------------------

async function spotifyAppToken(id: string, secret: string): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

// ---- helpers -----------------------------------------------------------------------

async function step(name: string, run: () => Promise<number>): Promise<void> {
  const started = Date.now();
  try {
    const n = await run();
    console.log(`${name.padEnd(34)} ${String(n).padStart(4)} songs  ${((Date.now() - started) / 1000).toFixed(1)}s${n ? '' : '  (kept previous)'}`);
  } catch (err) {
    console.log(`${name.padEnd(34)} failed: ${(err as Error).message} (kept previous)`);
  }
}

async function fetchJson<T>(url: string | undefined): Promise<T | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function decode(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

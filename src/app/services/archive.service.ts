import { Injectable, signal } from '@angular/core';

import {
  ArchiveDoc, ArchiveFile, ArchiveMetadataResponse, ArchiveScrapeResponse, ArchiveSearchResponse,
} from '../models/archive.model';
import { Song } from '../models/song.model';
import { cleanName, firstValue, parseLength } from '../utils/text.utils';

/** Songs shorter than this are clips; longer ones are nonstop mixes. Both are skipped. */
const MIN_SONG_SECONDS = 45;
const MAX_SONG_SECONDS = 25 * 60;
/**
 * Uploads we never play, in any playlist or language:
 *  - religious recitations, prayers and devotional recordings (of every faith)
 *  - talks, lectures, sermons, podcasts, audiobooks and other spoken audio
 *  - karaoke and instrumental versions
 *  - uploads from outside India (this is a site for Indian music)
 */
const BLOCKED = [
  'quran', 'koran', 'surah', 'sura', 'tilawat', 'tilawah', 'tafsir', 'hadith', 'naat', 'khutba', 'bayan', 'nasheed',
  'bhajan', 'aarti', 'mantra', 'chalisa', 'kirtan', 'gurbani', 'shabad', 'bhakti', 'devotional', 'stotram', 'hymn', 'gospel', 'bible', 'prayer', 'qawwali',
  'sermon', 'lecture', 'podcast', 'audiobook', '"audio book"', 'interview', 'speech', 'talk', 'news',
  'karaoke', 'instrumental',
  'pakistan', 'pakistani', 'lahore', 'karachi', 'islamabad', 'ptv', 'bangladesh', 'dhaka',
];
const EXCLUDE_QUERY = `NOT (${BLOCKED.join(' OR ')})`;
const EXCLUDE_NAME = new RegExp(`\\b(${BLOCKED.map(w => w.replace(/"/g, '')).join('|')}|qur'?an)\\b`, 'i');
/** Arabic/Urdu script: none of the site's languages use it, so titles in it are never a match. */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F]/;
/**
 * File names that aren't one real song: "Track 02", "Audio 3", "01", ringtones, jukeboxes, medleys.
 * (The deeper check, wrong language / covers / re-sung copies, is the AI check in scripts/ai-filter.ts.)
 */
const JUNK_TITLE = /^\s*(track|audio|song|untitled|file|recording|new recording)?\s*[-_ ]*\d*\s*$|\b(ringtone|jukebox|medley|non ?stop|nonstop|full album|audio book)\b/i;
/** Most songs taken from a single album, so one album can't fill a playlist. */
const MAX_SONGS_PER_ITEM = 40;

/** Tries per request before giving up (archive.org sometimes answers slowly or says "too many requests"). */
const ATTEMPTS = 3;
/** A request that hasn't answered after this long is cancelled and tried again (it used to hang forever). */
const TIMEOUT_MS = 12000;
/** At most this many archive.org requests at once. More than that and archive.org starts refusing them. */
const MAX_PARALLEL = 6;
/** Albums looked up recently are remembered, so switching back to a playlist is instant. */
const ALBUM_MEMORY = 400;

/**
 * Talks to the Internet Archive (archive.org). No API key needed.
 * Uses plain fetch(), so the same code also runs in the build script (scripts/build-playlists.ts).
 *  - search():   find albums matching a query, most downloaded first
 *  - getSongs(): list the playable MP3 songs inside one album
 */
@Injectable({ providedIn: 'root' })
export class ArchiveService {
  private readonly baseUrl = 'https://archive.org';
  /** Album covers saved on the phone with downloaded songs (album ID → local image). */
  private readonly localCovers = signal<Record<string, string>>({});
  /** Requests waiting for a free slot, and how many are running. */
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  /** Same URL asked twice at once: both get the one answer. */
  private readonly inFlight = new Map<string, Promise<unknown>>();
  /** Songs of albums already opened (album ID → songs). */
  private readonly albums = new Map<string, Song[]>();

  /** Albums matching `query`, or null if archive.org couldn't be reached. */
  async search(query: string, rows = 36, page = 1): Promise<ArchiveDoc[] | null> {
    const q = `mediatype:audio AND (${query}) AND ${EXCLUDE_QUERY}`;

    const params = new URLSearchParams([
      ['q', q], ['fl[]', 'identifier'], ['fl[]', 'title'], ['fl[]', 'creator'], ['fl[]', 'downloads'],
      ['sort[]', 'downloads desc'], ['rows', String(rows)], ['page', String(page)], ['output', 'json'],
    ]);
    const res = await this.getJson<ArchiveSearchResponse>(`${this.baseUrl}/advancedsearch.php?${params}`);
    if (res?.response?.docs) return res.response.docs;
    if (page > 1) return null; // the backup endpoint has no pages

    // Backup search endpoint
    const backup = new URLSearchParams([
      ['q', q], ['fields', 'identifier,title,creator,downloads'], ['sorts', 'downloads desc'], ['count', '100'],
    ]);
    const res2 = await this.getJson<ArchiveScrapeResponse>(`${this.baseUrl}/services/search/v1/scrape?${backup}`);
    return res2?.items ? res2.items.slice(0, rows) : null;
  }

  /** Playable songs in one album, in track order. Empty if the album is gone or restricted. */
  async getSongs(itemId: string): Promise<Song[]> {
    const known = this.albums.get(itemId);
    if (known) return known;
    const songs = await this.readSongs(itemId);
    if (songs.length) {
      if (this.albums.size >= ALBUM_MEMORY) this.albums.delete(this.albums.keys().next().value!);
      this.albums.set(itemId, songs);
    }
    return songs;
  }

  private async readSongs(itemId: string): Promise<Song[]> {
    try {
      const res = await this.getJson<ArchiveMetadataResponse>(`${this.baseUrl}/metadata/${encodeURIComponent(itemId)}`);
      if (!res || !Array.isArray(res.files) || res.is_dark) return [];

      const meta = res.metadata ?? {};
      if (String(meta['access-restricted-item']) === 'true') return [];
      const about = `${firstValue(meta.title)} ${firstValue(meta.creator)} ${[meta.subject ?? []].flat().join(' ')}`;
      if (EXCLUDE_NAME.test(about) || ARABIC_SCRIPT.test(about)) return [];

      const album = cleanName(firstValue(meta.title)) || itemId;
      const albumArtist = firstValue(meta.creator);

      // Originals first, so the de-duplication below keeps them over lower-quality copies.
      const mp3s = res.files
        .filter(f => /\.mp3$/i.test(f.name) && String(f.private) !== 'true' && !/(_sample|_preview|_spectrogram)/i.test(f.name))
        .filter(f => { const t = `${f.name} ${f.title ?? ''} ${firstValue(f.artist)}`; return !EXCLUDE_NAME.test(t) && !ARABIC_SCRIPT.test(t); })
        .sort((a, b) => (a.source === 'original' ? 0 : 1) - (b.source === 'original' ? 0 : 1));

      const seen = new Set<string>();
      const songs: Array<Song & { track: number }> = [];
      for (const file of mp3s) {
        const seconds = parseLength(file.length);
        if (seconds && (seconds < MIN_SONG_SECONDS || seconds > MAX_SONG_SECONDS)) continue;

        // "song.mp3" and its "song_64kb.mp3" copy are the same song
        const base = file.name.replace(/(_64kb|_128kb|_vbr)?\.mp3$/i, '').toLowerCase();
        if (seen.has(base)) continue;
        seen.add(base);

        const described = this.describe(file, albumArtist, album);
        if (JUNK_TITLE.test(described.title)) continue;
        songs.push({ ...described, itemId, file: file.name, album, track: parseInt(file.track ?? '', 10) || 999 });
      }

      return songs
        .sort((a, b) => a.track - b.track || a.file.localeCompare(b.file))
        .slice(0, MAX_SONGS_PER_ITEM)
        .map(({ track, ...song }) => song);
    } catch {
      return [];
    }
  }

  /** Direct MP3 link for the audio player. */
  songUrl(song: Song): string {
    const path = song.file.split('/').map(encodeURIComponent).join('/');
    return `${this.baseUrl}/download/${encodeURIComponent(song.itemId)}/${path}`;
  }

  /**
   * The same MP3 through archive.org's /cors/ address, which allows the equaliser
   * (Web Audio) and the website's downloads to read the sound.
   */
  corsUrl(song: Song): string {
    const path = song.file.split('/').map(encodeURIComponent).join('/');
    return `${this.baseUrl}/cors/${encodeURIComponent(song.itemId)}/${path}`;
  }

  /** Album cover (archive.org picks the item's main image), or the copy saved on the phone. */
  thumbnailUrl(itemId: string): string {
    return this.localCovers()[itemId] ?? this.remoteThumbnailUrl(itemId);
  }

  remoteThumbnailUrl(itemId: string): string {
    return `${this.baseUrl}/services/img/${encodeURIComponent(itemId)}`;
  }

  setLocalCover(itemId: string, src: string | null): void {
    this.localCovers.update(map => {
      const next = { ...map };
      if (src) next[itemId] = src; else delete next[itemId];
      return next;
    });
  }

  /**
   * GET a JSON URL: at most MAX_PARALLEL at once, each with a time limit, retrying on network errors,
   * time-outs, "too many requests" (waiting as long as archive.org asks) and server errors.
   * Null if it never works.
   */
  private getJson<T>(url: string): Promise<T | null> {
    const same = this.inFlight.get(url);
    if (same) return same as Promise<T | null>;
    const job = this.fetchJson<T>(url).finally(() => this.inFlight.delete(url));
    this.inFlight.set(url, job);
    return job;
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let wait = 800 * attempt;
      await this.slot();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: abort.signal });
        if (res.ok) return (await res.json()) as T;
        if (res.status !== 429 && res.status < 500) return null; // e.g. 404: retrying won't help
        const after = Number(res.headers.get('Retry-After'));
        if (after > 0) wait = Math.min(after * 1000, 10000);
      } catch {
        /* network error or time-out: retry */
      } finally {
        clearTimeout(timer);
        this.release();
      }
      if (attempt < ATTEMPTS) await new Promise(done => setTimeout(done, wait));
    }
    return null;
  }

  private slot(): Promise<void> {
    if (this.running < MAX_PARALLEL) { this.running++; return Promise.resolve(); }
    return new Promise(resolve => this.waiting.push(() => { this.running++; resolve(); }));
  }

  private release(): void {
    this.running--;
    this.waiting.shift()?.();
  }

  /** Title and artist from the file's tags, falling back to its file name. */
  private describe(file: ArchiveFile, albumArtist: string, album: string): { title: string; artist: string } {
    let title = cleanName(file.title) || cleanName(file.name.split('/').pop());
    let artist = cleanName(firstValue(file.artist) || firstValue(file.creator) || albumArtist);

    // File names like "Tujhe Dekha To - Kumar Sanu" when there are no tags
    if (!file.title && !artist) {
      const parts = title.split(/\s[-–—|]\s/);
      if (parts.length === 2) [title, artist] = parts;
    }
    if (artist.length > 60) artist = artist.slice(0, 57) + '…';
    return { title: title || 'Untitled', artist: artist || album };
  }
}

import { Injectable, computed, inject, signal } from '@angular/core';

import { SongRequest } from '../data/classical-drive';
import { ALL_STATIONS, DEFAULT_LANGUAGE, Language, findLanguage, stationsFor } from '../data/languages';
import { CACHE_DAYS, LIKED_STATION, MAX_SONGS, MIN_SONGS_BEFORE_BACKUP, STATIONS } from '../data/stations';
import { ArchiveDoc } from '../models/archive.model';
import { Song, songKey } from '../models/song.model';
import { Station, StationGroup } from '../models/station.model';
import { firstValue, normalize } from '../utils/text.utils';
import { ArchiveService } from './archive.service';
import { SongFinderService } from './song-finder.service';
import { StorageService } from './storage.service';

const KEY_CACHE = 'osfm.v4.songs';
const KEY_LIKED = 'osfm.v4.liked';
const KEY_STATION = 'osfm.station';
const KEY_LANGUAGE = 'osfm.lang';
/** Bump when the cached song format changes, so old caches are ignored. */
const CACHE_VERSION = 5;

interface CachedStation {
  version: number;
  savedAt: number;
  songs: Song[];
  /** For hand-picked lists: where to carry on looking next visit. Missing = list complete. */
  resumeAt?: number;
}

/**
 * Made at deploy time by scripts/build-playlists.ts: every playlist, already looked up.
 * Loading this one small file is what makes playlists open instantly.
 */
const PREBUILT_URL = 'playlists.json';
export interface PrebuiltPlaylists { generatedAt: string; playlists: Record<string, Song[]>; }

/** Hand-picked songs looked up at the same time. Higher = faster, but more load on archive.org. */
const SONG_LOOKUPS_AT_ONCE = 8;

/** A song found by search, with where it lives. */
export interface SongMatch { song: Song; station: Station; index: number; haystack: string; }

/**
 * Owns the playlists: which one is open, the songs each one has,
 * loading state, the browser cache and the visitor's liked songs.
 */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly archive = inject(ArchiveService);
  private readonly storage = inject(StorageService);
  private readonly finder = inject(SongFinderService);

  /** Songs per playlist key. Lists grow while a playlist loads. */
  private readonly songsByStation = signal<Record<string, Song[]>>({});
  /** true = loading, false = finished, missing = not started */
  private readonly loadingByStation = signal<Record<string, boolean>>({});
  /** Hand-picked lists only: how many songs have been looked up so far. */
  private readonly progressByStation = signal<Record<string, { done: number; total: number }>>({});
  /** Browser cache, read from storage once and kept in memory. */
  private cache: Record<string, CachedStation> = this.storage.get(KEY_CACHE, {});
  /** "Everything" playlists: how many pages of Archive search results are in, and whether there are more. */
  private readonly pagesLoaded = new Map<string, number>();
  private readonly exhausted = signal<Record<string, boolean>>({});
  readonly loadingMore = signal<string | null>(null);
  /** The prebuilt playlists file, fetched once. */
  private prebuilt?: Promise<Record<string, Song[]> | null>;
  /** A playlist made from a search result (an album), if any. */
  private readonly temporaryStation = signal<Station | null>(null);

  readonly liked = signal<Song[]>(this.readLiked());
  /** The music language the visitor picked (the switch in the header). */
  readonly language = signal<Language>(findLanguage(this.storage.get(KEY_LANGUAGE, DEFAULT_LANGUAGE)));
  /** Playlists shown in the menu, for the current language. "Liked" has its own button next to the headline. */
  readonly stations = computed<Station[]>(() => stationsFor(this.language()));
  readonly groups = computed<StationGroup[]>(() => groupStations(this.stations()));

  private readonly selectedKey = signal<string>(this.storage.get(KEY_STATION, 'top'));
  /** The playlist shown in the song list. */
  readonly selected = computed<Station>(() => this.findStation(this.selectedKey()) ?? this.stations()[0]);

  constructor() {
    // Clean up data left by the old single-file version of the site.
    ['osfm.titles', 'osfm.index', 'osfm.sort', 'osfm.ia', 'osfm.liked2'].forEach(k => this.storage.remove(k));
  }

  findStation(key: string): Station | undefined {
    const temp = this.temporaryStation();
    if (temp?.key === key) return temp;
    if (key === LIKED_STATION.key) return LIKED_STATION;
    // Look in every language, so a song saved from another language still resumes after a refresh.
    return this.stations().find(s => s.key === key) ?? ALL_STATIONS.find(s => s.key === key);
  }

  /** Switches the music language and opens its first playlist (playback carries on until the visitor picks a song). */
  setLanguage(language: Language): void {
    this.language.set(language);
    this.storage.set(KEY_LANGUAGE, language.code);
    this.select(this.stations()[0]);
  }

  songsFor(key: string): Song[] {
    return key === LIKED_STATION.key ? this.liked() : (this.songsByStation()[key] ?? []);
  }

  isLoading(key: string): boolean {
    return this.loadingByStation()[key] === true;
  }

  /** True for "Everything" playlists that can still load more songs. */
  canLoadMore(station: Station): boolean {
    return !!station.endless && this.isFinished(station.key) && !this.exhausted()[station.key];
  }

  /**
   * "Load more songs": opens the next page of the most-played Archive albums for this
   * playlist and adds their songs to the end. Live from archive.org, so it takes a few seconds.
   */
  async loadMore(station: Station): Promise<void> {
    if (!station.query || this.loadingMore()) return;
    this.loadingMore.set(station.key);
    try {
      const existing = this.songsFor(station.key);
      const titles = new Set(existing.map(s => normalize(s.title)));
      const items = new Set(existing.map(s => s.itemId));
      let added: Song[] = [];
      // Keep turning pages until something new turns up (or the Archive runs out).
      for (let tries = 0; tries < 4 && !added.length; tries++) {
        const page = (this.pagesLoaded.get(station.key) ?? 0) + 1; // page 1 again first: it may have albums the first load didn't need
        this.pagesLoaded.set(station.key, page);
        const docs = await this.archive.search(station.query, 36, page);
        if (!docs?.length) { this.exhausted.update(m => ({ ...m, [station.key]: true })); break; } // the Archive has no more
        const ids = usableIds(docs).filter(id => !items.has(id));
        if (!ids.length) continue; // every album on this page is already in the list: try the next page
        for (let i = 0; i < ids.length; i += 6) {
          const albums = await Promise.all(ids.slice(i, i + 6).map(id => this.archive.getSongs(id)));
          ids.slice(i, i + 6).forEach(id => items.add(id));
          const fresh = interleave(albums).filter(s => { const t = normalize(s.title); if (!t || titles.has(t)) return false; titles.add(t); return true; });
          if (fresh.length) {
            added = [...added, ...fresh];
            this.setSongs(station.key, [...existing, ...added]);
          }
        }
      }
    } finally {
      this.loadingMore.set(null);
    }
  }

  /** e.g. { done: 24, total: 200 } while a hand-picked list is being looked up. */
  progressFor(key: string): { done: number; total: number } | undefined {
    return this.progressByStation()[key];
  }

  isFinished(key: string): boolean {
    return key === LIKED_STATION.key || this.loadingByStation()[key] === false;
  }

  /** Opens a playlist in the song list and starts loading its songs. */
  select(station: Station): void {
    if (station.isTemporary) this.temporaryStation.set(station);
    else this.storage.set(KEY_STATION, station.key);
    this.selectedKey.set(station.key);
    this.load(station);
  }

  /**
   * Fills a playlist. Fastest source first:
   *  1. playlists.json shipped with the site (instant, refreshed daily by GitHub Actions)
   *  2. this browser's cache
   *  3. live lookups on archive.org (slow; also used for albums opened from search)
   * Safe to call repeatedly.
   */
  async load(station: Station): Promise<void> {
    if (station.isLiked || this.loadingByStation()[station.key] !== undefined) return;

    if (!station.isTemporary) {
      this.setLoading(station.key, true);
      const ready = (await this.loadPrebuilt())?.[station.key];
      if (ready?.length) {
        this.setSongs(station.key, ready);
        this.setLoading(station.key, false);
        return;
      }
    }

    const cached = this.readCache()[station.key];
    if (cached && cached.version === CACHE_VERSION && Date.now() - cached.savedAt < CACHE_DAYS * 864e5 && cached.songs.length) {
      this.setSongs(station.key, cached.songs);
      // A hand-picked list that was only partly looked up last time: carry on from there.
      if (station.songList && cached.resumeAt !== undefined) {
        this.setLoading(station.key, true);
        await this.addFromSongList(station, station.songList, cached.resumeAt, cached.songs);
      }
      this.setLoading(station.key, false);
      return;
    }

    this.setSongs(station.key, []);
    this.setLoading(station.key, true);

    const titlesSeen = new Set<string>();
    const itemsDone = new Set<string>();
    let songs: Song[] = [];

    /** Opens albums four at a time and adds their songs, mixed together. */
    const addFromItems = async (itemIds: string[]) => {
      const todo = itemIds.filter(id => !itemsDone.has(id));
      for (let i = 0; i < todo.length && songs.length < MAX_SONGS; i += 4) {
        const batch = todo.slice(i, i + 4);
        batch.forEach(id => itemsDone.add(id));
        const albums = await Promise.all(batch.map(id => this.archive.getSongs(id)));

        const fresh: Song[] = [];
        for (const song of interleave(albums)) {
          const title = normalize(song.title);
          if (!title || titlesSeen.has(title)) continue;
          titlesSeen.add(title);
          fresh.push(song);
          if (songs.length + fresh.length >= MAX_SONGS) break;
        }
        if (fresh.length) {
          songs = [...songs, ...fresh];
          this.setSongs(station.key, songs);
        }
      }
    };

    if (station.songList?.length) songs = await this.addFromSongList(station, station.songList, 0, []);
    if (station.items?.length) await addFromItems(station.items);
    if (station.query) await addFromItems(usableIds(await this.archive.search(station.query)));
    if (station.backupQuery && songs.length < MIN_SONGS_BEFORE_BACKUP) {
      await addFromItems(usableIds(await this.archive.search(station.backupQuery)));
    }

    this.setLoading(station.key, false);
    // Hand-picked lists save as they go (see addFromSongList).
    if (songs.length && !station.isTemporary && !station.songList) this.writeCache(station.key, songs);
  }

  isLiked(song: Song | null): boolean {
    if (!song) return false;
    const key = songKey(song);
    return this.liked().some(s => songKey(s) === key);
  }

  /** Adds or removes a heart. Returns true if the song is now liked. */
  toggleLike(song: Song): boolean {
    const key = songKey(song);
    const wasLiked = this.isLiked(song);
    const next = wasLiked ? this.liked().filter(s => songKey(s) !== key) : [...this.liked(), song];
    this.liked.set(next);
    this.storage.set(KEY_LIKED, next);
    return !wasLiked;
  }

  /** Every known song across all playlists (loaded or cached), for the search box. */
  readonly searchable = computed<SongMatch[]>(() => {
    const loaded = this.songsByStation();
    const cache = this.readCache();
    const seen = new Set<string>();
    const out: SongMatch[] = [];
    for (const station of this.stations()) {
      const songs = loaded[station.key]?.length ? loaded[station.key] : (cache[station.key]?.songs ?? []);
      songs.forEach((song, index) => {
        const title = normalize(song.title);
        if (seen.has(title)) return;
        seen.add(title);
        out.push({ song, station, index, haystack: normalize(`${song.title} ${song.artist} ${song.album}`) });
      });
    }
    return out;
  });

  // ---- private helpers ----------------------------------------------------

  /** Fetches playlists.json once. Null when it's missing (e.g. `npm start` before running `npm run playlists`). */
  private loadPrebuilt(): Promise<Record<string, Song[]> | null> {
    if (!this.prebuilt) {
      this.prebuilt = typeof document === 'undefined'
        ? Promise.resolve(null) // running in the build script itself
        : fetch(PREBUILT_URL)
            .then(res => (res.ok ? (res.json() as Promise<PrebuiltPlaylists>) : null))
            .then(file => file?.playlists ?? null)
            .catch(() => null);
    }
    return this.prebuilt;
  }

  /**
   * Looks up hand-picked songs, several at a time, and adds the ones found in list order.
   * Progress is saved after every batch, so a visitor who leaves early doesn't start over.
   */
  private async addFromSongList(station: Station, requests: SongRequest[], start: number, already: Song[]): Promise<Song[]> {
    let songs = already;
    const seen = new Set(songs.map(songKey));
    const total = requests.length;

    for (let i = start; i < total; i += SONG_LOOKUPS_AT_ONCE) {
      this.setProgress(station.key, i, total);
      const found = await Promise.all(requests.slice(i, i + SONG_LOOKUPS_AT_ONCE).map(r => this.finder.find(r)));
      const fresh = found.filter((s): s is Song => !!s && !seen.has(songKey(s)));
      fresh.forEach(s => seen.add(songKey(s)));
      if (fresh.length) {
        songs = [...songs, ...fresh];
        this.setSongs(station.key, songs);
      }
      const next = i + SONG_LOOKUPS_AT_ONCE;
      if (songs.length) this.writeCache(station.key, songs, next < total ? next : undefined);
    }
    this.setProgress(station.key, total, total);
    return songs;
  }

  private setProgress(key: string, done: number, total: number): void {
    this.progressByStation.update(map => ({ ...map, [key]: { done: Math.min(done, total), total } }));
  }

  private setSongs(key: string, songs: Song[]): void {
    this.songsByStation.update(map => ({ ...map, [key]: songs }));
  }

  private setLoading(key: string, loading: boolean): void {
    this.loadingByStation.update(map => ({ ...map, [key]: loading }));
  }

  private readCache(): Record<string, CachedStation> {
    return this.cache;
  }

  private writeCache(key: string, songs: Song[], resumeAt?: number): void {
    // Keep the original save time while a list is still filling, so it still refreshes after CACHE_DAYS.
    const savedAt = this.cache[key]?.resumeAt !== undefined ? this.cache[key].savedAt : Date.now();
    this.cache = { ...this.cache, [key]: { version: CACHE_VERSION, savedAt, songs, resumeAt } };
    // If the browser's storage is full, keep just this playlist.
    if (!this.storage.set(KEY_CACHE, this.cache)) this.storage.set(KEY_CACHE, { [key]: this.cache[key] });
  }

  private readLiked(): Song[] {
    const liked = this.storage.get<Song[] | null>(KEY_LIKED, null);
    if (liked) return liked;
    // Carry over hearts from the old single-file version.
    const old = this.storage.get<Array<{ i: string; f: string; t: string; a: string; al: string }>>('osfm.liked2', []);
    const migrated = old.filter(o => o?.i && o?.f).map(o => ({ itemId: o.i, file: o.f, title: o.t, artist: o.a, album: o.al }));
    if (migrated.length) this.storage.set(KEY_LIKED, migrated);
    return migrated;
  }
}

/** Groups playlists under their menu headings, keeping the order they're defined in. */
function groupStations(stations: Station[]): StationGroup[] {
  const groups: StationGroup[] = [];
  for (const station of stations) {
    let group = groups.find(g => g.name === station.group);
    if (!group) groups.push(group = { name: station.group, stations: [] });
    group.stations.push(station);
  }
  return groups;
}

/** Takes one song from each album in turn: A1, B1, C1, A2, B2, C2 … */
function interleave(albums: Song[][]): Song[] {
  const out: Song[] = [];
  for (let round = 0; albums.some(a => a[round]); round++) {
    for (const album of albums) if (album[round]) out.push(album[round]);
  }
  return out;
}

/** Album IDs from search results, skipping podcasts and audiobooks. */
function usableIds(docs: ArchiveDoc[] | null): string[] {
  const ids = (docs ?? [])
    .filter(d => d?.identifier && !/podcast|episode|radio show|audiobook/i.test(firstValue(d.title)))
    .map(d => d.identifier);
  return [...new Set(ids)];
}

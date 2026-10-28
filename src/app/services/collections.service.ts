import { Injectable, computed, inject, signal } from '@angular/core';

import { Song, songKey } from '../models/song.model';
import { Station } from '../models/station.model';
import { StorageService } from './storage.service';

/*
 * The listener's own Library: playlists they make, smart playlists that fill themselves
 * from what they play, pins, and "recently deleted". Everything is kept on this device
 * (and backed up to the account, if they have one — see account.service.ts).
 *
 * Things here that Spotify doesn't do:
 *  - smart playlists (On Repeat, Your top songs, Recently played, Forgotten favourites) built from
 *    YOUR plays, with the play count shown on every song
 *  - unlimited pins
 *  - "Recently deleted": a deleted playlist can be brought back for 30 days, right in the app
 *  - export / import playlists as a file (share with a friend, keep a backup)
 *  - a duplicate check when adding songs
 */

export interface UserPlaylist {
  id: string;
  name: string;
  /** Shown on the tile, e.g. "🚗" */
  emoji: string;
  color: string;
  songs: Song[];
  createdAt: number;
  updatedAt: number;
  /** Set when deleted; the playlist stays restorable for RESTORE_DAYS. */
  deletedAt?: number;
}

/** How often and when a song was played (counted once it has played for PLAY_COUNTS_AFTER_S seconds). */
export interface PlayStat {
  song: Song;
  count: number;
  last: number;
  /** Times of the most recent plays, newest last (for On Repeat). */
  recent: number[];
}

export type SmartKind = 'repeat' | 'top' | 'recent' | 'forgotten';

export interface SmartDefinition { kind: SmartKind; name: string; subtitle: string; mark: string; color: string; }

export const SMART_PLAYLISTS: SmartDefinition[] = [
  { kind: 'repeat', name: 'On Repeat', subtitle: 'What you keep coming back to, last 14 days', mark: '↻', color: '#FF7A59' },
  { kind: 'top', name: 'Your Top Songs', subtitle: 'All-time, with your play counts', mark: '#1', color: '#FFB36B' },
  { kind: 'recent', name: 'Recently Played', subtitle: 'Your full listening history', mark: '◷', color: '#5EC8FF' },
  { kind: 'forgotten', name: 'Forgotten Favourites', subtitle: "Liked songs you haven't played in a month", mark: '✧', color: '#9B59FF' },
];

/** Colours offered for a new playlist's tile. */
export const PLAYLIST_COLORS = ['#FF6F91', '#FF9F43', '#FFB36B', '#2FC4A0', '#5EC8FF', '#5B6CFF', '#9B59FF', '#FF4F8B'];
export const PLAYLIST_EMOJIS = ['♫', '🚗', '🌙', '☕', '💃', '💔', '🌧', '🔥', '🏋', '📚', '✈', '♡'];

/** A song counts as "played" after this many seconds. */
export const PLAY_COUNTS_AFTER_S = 30;
const RESTORE_DAYS = 30;
const SMART_SIZE = 100;
const REPEAT_DAYS = 14;
const FORGOTTEN_DAYS = 30;
/** How many recent play times are kept per song. */
const RECENT_KEPT = 12;
const MAX_HISTORY = 2000;

const KEY_PLAYLISTS = 'cfm.playlists';
const KEY_PLAYS = 'cfm.plays';
const KEY_PINS = 'cfm.pins';
const KEY_OPENED = 'cfm.opened';

export const USER_PREFIX = 'pl:';
export const SMART_PREFIX = 'smart:';

/** What's backed up to the account and written to an export file. */
export interface LibrarySnapshot {
  playlists: UserPlaylist[];
  plays?: Record<string, PlayStat>;
  pins?: string[];
}

/** Export file format. */
interface ExportFile { app: 'cassette.fm'; kind: 'playlists'; version: 1; exportedAt: string; playlists: Array<Pick<UserPlaylist, 'name' | 'emoji' | 'color' | 'songs'>>; }

@Injectable({ providedIn: 'root' })
export class CollectionsService {
  private readonly storage = inject(StorageService);

  private readonly all = signal<UserPlaylist[]>(this.storage.get<UserPlaylist[]>(KEY_PLAYLISTS, []));
  readonly plays = signal<Record<string, PlayStat>>(this.storage.get(KEY_PLAYS, {}));
  /** Pinned Library items (station keys). Liked songs is pinned to start with. */
  readonly pins = signal<string[]>(this.storage.get<string[]>(KEY_PINS, ['liked']));
  /** When each Library item was last opened, for "Recents" sorting. */
  readonly opened = signal<Record<string, number>>(this.storage.get(KEY_OPENED, {}));

  readonly playlists = computed(() => this.all().filter(p => !p.deletedAt));
  readonly deleted = computed(() => this.all().filter(p => p.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!));

  /** Menu entries for the listener's own playlists. */
  readonly userStations = computed<Station[]>(() => this.playlists().map(p => ({
    key: USER_PREFIX + p.id, group: 'Your playlists', name: p.name,
    subtitle: `${p.songs.length} ${p.songs.length === 1 ? 'song' : 'songs'}`, mark: p.emoji, color: p.color, isUser: true,
  })));

  constructor() {
    this.purgeOld();
  }

  readonly smartStations: Station[] = SMART_PLAYLISTS.map(s => ({
    key: SMART_PREFIX + s.kind, group: 'Made from your plays', name: s.name, subtitle: s.subtitle, mark: s.mark, color: s.color, isSmart: true,
  }));

  // ---- playlists ------------------------------------------------------------

  playlist(id: string): UserPlaylist | undefined {
    return this.all().find(p => p.id === id && !p.deletedAt);
  }

  /** Creates a playlist (optionally with songs already in it). Returns it. */
  create(name: string, songs: Song[] = []): UserPlaylist {
    const n = this.playlists().length;
    const now = Date.now();
    const playlist: UserPlaylist = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim() || `My playlist #${n + 1}`,
      emoji: PLAYLIST_EMOJIS[n % PLAYLIST_EMOJIS.length],
      color: PLAYLIST_COLORS[n % PLAYLIST_COLORS.length],
      songs: dedupe(songs), createdAt: now, updatedAt: now,
    };
    this.write([...this.all(), playlist]);
    this.markOpened(USER_PREFIX + playlist.id);
    return playlist;
  }

  update(id: string, change: Partial<Pick<UserPlaylist, 'name' | 'emoji' | 'color'>>): void {
    this.edit(id, p => ({ ...p, ...change, name: (change.name ?? p.name).trim() || p.name }));
  }

  /** Adds songs, skipping ones already in the playlist. Returns how many were added. */
  addSongs(id: string, songs: Song[]): number {
    const playlist = this.playlist(id);
    if (!playlist) return 0;
    const have = new Set(playlist.songs.map(songKey));
    const fresh = dedupe(songs).filter(s => !have.has(songKey(s)));
    if (fresh.length) this.edit(id, p => ({ ...p, songs: [...p.songs, ...fresh] }));
    return fresh.length;
  }

  removeSong(id: string, song: Song): void {
    const key = songKey(song);
    this.edit(id, p => ({ ...p, songs: p.songs.filter(s => songKey(s) !== key) }));
  }

  /** Moves a song up (-1) or down (+1) in the playlist. */
  moveSong(id: string, song: Song, step: -1 | 1): void {
    this.edit(id, p => {
      const from = p.songs.findIndex(s => songKey(s) === songKey(song));
      const to = from + step;
      if (from < 0 || to < 0 || to >= p.songs.length) return p;
      const songs = [...p.songs];
      [songs[from], songs[to]] = [songs[to], songs[from]];
      return { ...p, songs };
    });
  }

  contains(id: string, song: Song): boolean {
    const key = songKey(song);
    return !!this.playlist(id)?.songs.some(s => songKey(s) === key);
  }

  /** Moves a playlist to "Recently deleted" (restorable for 30 days). */
  remove(id: string): void {
    this.edit(id, p => ({ ...p, deletedAt: Date.now() }));
    this.pins.update(pins => pins.filter(k => k !== USER_PREFIX + id));
    this.storage.set(KEY_PINS, this.pins());
  }

  restore(id: string): void {
    this.write(this.all().map(p => (p.id === id ? { ...p, deletedAt: undefined, updatedAt: Date.now() } : p)));
  }

  deleteForever(id: string): void {
    this.write(this.all().filter(p => p.id !== id));
  }

  // ---- plays & smart playlists ---------------------------------------------

  /** Called by the player once a song has played for PLAY_COUNTS_AFTER_S seconds. */
  recordPlay(song: Song): void {
    const key = songKey(song);
    const now = Date.now();
    this.plays.update(all => {
      const was = all[key];
      const next = { ...all, [key]: { song, count: (was?.count ?? 0) + 1, last: now, recent: [...(was?.recent ?? []), now].slice(-RECENT_KEPT) } };
      return trimHistory(next);
    });
    this.storage.set(KEY_PLAYS, this.plays());
  }

  playCount(song: Song): number {
    return this.plays()[songKey(song)]?.count ?? 0;
  }

  /** The songs of a smart playlist. `liked` is needed for Forgotten Favourites. */
  smartSongs(kind: SmartKind, liked: Song[]): Song[] {
    const stats = Object.values(this.plays());
    const now = Date.now();
    switch (kind) {
      case 'repeat': {
        const since = now - REPEAT_DAYS * 864e5;
        return stats
          .map(s => ({ s, n: s.recent.filter(t => t >= since).length }))
          .filter(x => x.n >= 2)
          .sort((a, b) => b.n - a.n || b.s.last - a.s.last)
          .slice(0, SMART_SIZE).map(x => x.s.song);
      }
      case 'top':
        return stats.sort((a, b) => b.count - a.count || b.last - a.last).slice(0, SMART_SIZE).map(s => s.song);
      case 'recent':
        return stats.sort((a, b) => b.last - a.last).slice(0, SMART_SIZE).map(s => s.song);
      case 'forgotten': {
        const before = now - FORGOTTEN_DAYS * 864e5;
        const plays = this.plays();
        return liked
          .filter(song => (plays[songKey(song)]?.last ?? 0) < before)
          .sort((a, b) => (plays[songKey(a)]?.last ?? 0) - (plays[songKey(b)]?.last ?? 0))
          .slice(0, SMART_SIZE);
      }
    }
  }

  clearHistory(): void {
    this.plays.set({});
    this.storage.set(KEY_PLAYS, {});
  }

  // ---- pins & recents --------------------------------------------------------

  isPinned(key: string): boolean {
    return this.pins().includes(key);
  }

  togglePin(key: string): boolean {
    const pinned = this.isPinned(key);
    this.pins.set(pinned ? this.pins().filter(k => k !== key) : [key, ...this.pins()]);
    this.storage.set(KEY_PINS, this.pins());
    return !pinned;
  }

  markOpened(key: string): void {
    this.opened.update(map => ({ ...map, [key]: Date.now() }));
    this.storage.set(KEY_OPENED, this.opened());
  }

  // ---- export / import / backup -----------------------------------------------

  /** A file with the given playlists (all of them when no IDs are given). */
  exportFile(ids?: string[]): string {
    const chosen = this.playlists().filter(p => !ids || ids.includes(p.id));
    const file: ExportFile = {
      app: 'cassette.fm', kind: 'playlists', version: 1, exportedAt: new Date().toISOString(),
      playlists: chosen.map(({ name, emoji, color, songs }) => ({ name, emoji, color, songs })),
    };
    return JSON.stringify(file, null, 1);
  }

  /** Reads an export file. Returns how many playlists were added. Throws on a file that isn't one. */
  importFile(text: string): number {
    const file = JSON.parse(text) as Partial<ExportFile>;
    if (file?.app !== 'cassette.fm' || !Array.isArray(file.playlists)) throw new Error('not-a-playlist-file');
    let added = 0;
    for (const p of file.playlists) {
      const songs = (p.songs ?? []).filter(isSong);
      if (!p.name || !songs.length) continue;
      const taken = new Set(this.playlists().map(x => x.name.toLowerCase()));
      const name = taken.has(p.name.toLowerCase()) ? `${p.name} (imported)` : p.name;
      const made = this.create(name, songs);
      this.update(made.id, { emoji: p.emoji || made.emoji, color: p.color || made.color });
      added++;
    }
    return added;
  }

  snapshot(): LibrarySnapshot {
    // The most recent 400 plays are plenty for the smart playlists and keep the backup small.
    const plays = Object.fromEntries(Object.entries(this.plays()).sort((x, y) => y[1].last - x[1].last).slice(0, 400));
    return { playlists: this.all(), plays, pins: this.pins() };
  }

  /** Merges an account backup into this device's Library (newest copy of each playlist wins). */
  merge(cloud: LibrarySnapshot): void {
    const byId = new Map(this.all().map(p => [p.id, p]));
    for (const p of cloud.playlists ?? []) {
      const mine = byId.get(p.id);
      if (!mine || p.updatedAt > mine.updatedAt) byId.set(p.id, p);
    }
    this.write([...byId.values()]);
    if (cloud.plays) {
      const plays = { ...cloud.plays };
      for (const [k, s] of Object.entries(this.plays())) {
        const c = plays[k];
        plays[k] = !c ? s : { song: s.song, count: Math.max(c.count, s.count), last: Math.max(c.last, s.last), recent: [...new Set([...c.recent, ...s.recent])].sort().slice(-RECENT_KEPT) };
      }
      this.plays.set(trimHistory(plays));
      this.storage.set(KEY_PLAYS, this.plays());
    }
    if (cloud.pins?.length) {
      this.pins.set([...new Set([...this.pins(), ...cloud.pins])]);
      this.storage.set(KEY_PINS, this.pins());
    }
  }

  // ---- private ---------------------------------------------------------------

  private edit(id: string, change: (p: UserPlaylist) => UserPlaylist): void {
    this.write(this.all().map(p => (p.id === id ? { ...change(p), updatedAt: Date.now() } : p)));
  }

  private write(list: UserPlaylist[]): void {
    this.all.set(list);
    this.storage.set(KEY_PLAYLISTS, list);
  }

  private purgeOld(): void {
    const limit = Date.now() - RESTORE_DAYS * 864e5;
    const list = this.all();
    const kept = list.filter(p => !p.deletedAt || p.deletedAt > limit);
    if (kept.length !== list.length) this.write(kept);
  }
}

function dedupe(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter(s => { const k = songKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
}

function isSong(s: unknown): s is Song {
  const x = s as Song;
  return !!x && typeof x.itemId === 'string' && typeof x.file === 'string' && typeof x.title === 'string';
}

/** Keeps the history from growing forever: drops the songs played longest ago. */
function trimHistory(all: Record<string, PlayStat>): Record<string, PlayStat> {
  const entries = Object.entries(all);
  if (entries.length <= MAX_HISTORY) return all;
  return Object.fromEntries(entries.sort((a, b) => b[1].last - a[1].last).slice(0, MAX_HISTORY));
}

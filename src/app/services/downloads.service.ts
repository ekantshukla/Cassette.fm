import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';

import { Song, songKey } from '../models/song.model';
import { ArchiveService } from './archive.service';
import { LibraryService } from './library.service';
import { NativeService } from './native.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';
import { ToastService } from './toast.service';

/** One song saved for listening offline. */
interface SavedSong {
  song: Song;
  /** App: file inside the app's own storage, e.g. "songs/ab12cd.mp3". Website: "" (kept in IndexedDB). */
  path: string;
  bytes: number;
  savedAt: number;
}

const KEY = 'cfm.downloads';
/** Songs downloading at the same time. */
const AT_ONCE = 2;
/** Anything smaller is an error page, not a song. */
const MIN_BYTES = 60_000;
/** For the "about 450 MB" estimate before a big download. */
export const AVERAGE_SONG_BYTES = 5_500_000;

export type DownloadState = 'none' | 'queued' | 'downloading' | 'done';

/**
 * Saves songs for listening without internet.
 *  - Android app: MP3 files in the app's own storage (no permission needed, removed with the app).
 *  - Website: kept in the browser (IndexedDB). Works, but the browser may clear it when space runs low.
 * Album covers are saved too, so the Downloads list looks right offline.
 */
@Injectable({ providedIn: 'root' })
export class DownloadsService {
  private readonly archive = inject(ArchiveService);
  private readonly library = inject(LibraryService);
  private readonly native = inject(NativeService);
  private readonly settings = inject(SettingsService);
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  private readonly saved = signal<SavedSong[]>(this.storage.get<SavedSong[]>(KEY, []));
  private readonly byKey = computed(() => new Map(this.saved().map(s => [songKey(s.song), s])));
  /** Waiting + downloading songs; value = progress 0…1 */
  private readonly active = signal<Record<string, number>>({});
  private queue: Song[] = [];
  private running = 0;
  private batch = { done: 0, failed: 0 };
  /** App: the folder that holds the files, as a file:// address. */
  private baseUri = '';
  /** Download address → song key, to match progress events. */
  private readonly urlToKey = new Map<string, string>();
  /** Website: object URLs made from saved songs. */
  private readonly blobUrls = new Map<string, string>();

  readonly songs = computed(() => this.saved().map(s => s.song));
  readonly count = computed(() => this.saved().length);
  readonly totalBytes = computed(() => this.saved().reduce((n, s) => n + s.bytes, 0));
  /** Songs still to go in the current downloads. */
  readonly pending = computed(() => Object.keys(this.active()).length);

  constructor() {
    if (typeof window === 'undefined') return;
    effect(() => this.library.downloaded.set(this.songs()));
    if (this.native.isApp) {
      this.prepareApp();
    }
  }

  stateOf(song: Song): DownloadState {
    const key = songKey(song);
    if (this.byKey().has(key)) return 'done';
    const p = this.active()[key];
    if (p === undefined) return 'none';
    return p > 0 ? 'downloading' : 'queued';
  }

  progressOf(song: Song): number {
    return this.active()[songKey(song)] ?? 0;
  }

  isDownloaded(song: Song): boolean {
    return this.byKey().has(songKey(song));
  }

  /**
   * Adds songs to the download queue. `quiet` = no messages (auto-download of liked songs).
   * Returns how many were queued.
   */
  download(songs: Song[], quiet = false): number {
    if (!this.native.online()) {
      if (!quiet) this.toast.show("You're offline. Connect to the internet to download.");
      return 0;
    }
    // Downloads work on any internet: Wi-Fi or mobile data.
    const active = this.active();
    const fresh = songs.filter((s, i, all) => {
      const key = songKey(s);
      return !this.byKey().has(key) && active[key] === undefined && all.findIndex(o => songKey(o) === key) === i;
    });
    if (!fresh.length) return 0;
    if (!this.running && !this.queue.length) this.batch = { done: 0, failed: 0 };
    this.queue.push(...fresh);
    this.active.update(map => ({ ...map, ...Object.fromEntries(fresh.map(s => [songKey(s), 0])) }));
    if (!quiet) this.toast.show(fresh.length === 1 ? 'Downloading…' : `Downloading ${fresh.length} songs…`);
    this.pump();
    return fresh.length;
  }

  /** Stops songs that haven't started yet (the ones downloading finish). */
  cancelWaiting(): void {
    const waiting = new Set(this.queue.map(songKey));
    this.queue = [];
    this.active.update(map => Object.fromEntries(Object.entries(map).filter(([k]) => !waiting.has(k))));
  }

  async remove(song: Song): Promise<void> {
    const entry = this.byKey().get(songKey(song));
    if (!entry) return;
    this.saved.update(list => list.filter(s => s !== entry));
    this.persist();
    await this.deleteFile(entry);
    this.forgetCoverIfUnused(song.itemId);
  }

  async removeAll(): Promise<void> {
    const all = this.saved();
    this.cancelWaiting();
    this.saved.set([]);
    this.persist();
    if (this.native.isApp) {
      await Filesystem.rmdir({ directory: Directory.Data, path: 'songs', recursive: true }).catch(() => undefined);
      await Filesystem.rmdir({ directory: Directory.Data, path: 'covers', recursive: true }).catch(() => undefined);
      all.forEach(s => this.archive.setLocalCover(s.song.itemId, null));
    } else {
      await idb('clear').catch(() => undefined);
      this.blobUrls.forEach(url => URL.revokeObjectURL(url));
      this.blobUrls.clear();
    }
  }

  /**
   * Address the player can use straight away for a saved song, or null.
   * (Website songs need srcLater() the first time.)
   */
  srcNow(song: Song): string | null {
    const entry = this.byKey().get(songKey(song));
    if (!entry) return null;
    if (this.native.isApp) return this.baseUri ? this.native.fileSrc(`${this.baseUri}/${entry.path}`) : null;
    return this.blobUrls.get(songKey(song)) ?? null;
  }

  async srcLater(song: Song): Promise<string | null> {
    const now = this.srcNow(song);
    if (now) return now;
    if (!this.isDownloaded(song)) return null;
    if (this.native.isApp) {
      await this.ready;
      return this.srcNow(song);
    }
    const blob = await idb<Blob | undefined>('get', songKey(song)).catch(() => undefined);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(songKey(song), url);
    return url;
  }

  // ---- private ------------------------------------------------------------

  private ready: Promise<void> = Promise.resolve();

  private prepareApp(): void {
    this.ready = (async () => {
      try {
        this.baseUri = (await Filesystem.getUri({ directory: Directory.Data, path: '' })).uri.replace(/\/$/, '');
        await Filesystem.mkdir({ directory: Directory.Data, path: 'songs', recursive: true }).catch(() => undefined);
        await Filesystem.mkdir({ directory: Directory.Data, path: 'covers', recursive: true }).catch(() => undefined);
        // Show saved covers.
        for (const id of new Set(this.saved().map(s => s.song.itemId))) {
          const cover = `covers/${fileId(id)}.jpg`;
          const exists = await Filesystem.stat({ directory: Directory.Data, path: cover }).then(() => true, () => false);
          if (exists) this.archive.setLocalCover(id, this.native.fileSrc(`${this.baseUri}/${cover}`));
        }
      } catch {
        /* storage not available: songs just stream */
      }
    })();

    FileTransfer.addListener('progress', p => {
      const key = this.urlToKey.get(p.url);
      if (!key || !p.lengthComputable || !p.contentLength) return;
      const value = Math.max(0.02, Math.min(0.99, p.bytes / p.contentLength));
      // Only redraw in steps of 2%, so the list doesn't redraw hundreds of times per song.
      if (Math.abs((this.active()[key] ?? 0) - value) < 0.02) return;
      this.active.update(map => (key in map ? { ...map, [key]: value } : map));
    }).catch(() => undefined);
  }

  private pump(): void {
    while (this.running < AT_ONCE && this.queue.length) {
      const song = this.queue.shift()!;
      this.running++;
      this.fetchOne(song)
        .then(entry => {
          this.saved.update(list => [...list.filter(s => songKey(s.song) !== songKey(song)), entry]);
          this.persist();
          this.batch.done++;
        })
        .catch(() => { this.batch.failed++; })
        .finally(() => {
          this.active.update(map => { const next = { ...map }; delete next[songKey(song)]; return next; });
          this.running--;
          if (!this.running && !this.queue.length) this.finished();
          else this.pump();
        });
    }
  }

  private finished(): void {
    const { done, failed } = this.batch;
    if (!done && !failed) return;
    if (!failed) this.toast.show(done === 1 ? 'Downloaded. Plays without internet now.' : `${done} songs downloaded`);
    else if (!done) this.toast.show("Couldn't download. Check your internet and try again.");
    else this.toast.show(`${done} songs downloaded, ${failed} couldn't be saved`);
  }

  private async fetchOne(song: Song): Promise<SavedSong> {
    return this.native.isApp ? this.fetchToFile(song) : this.fetchToBrowser(song);
  }

  /** App: native download straight to a file (no size limits, no CORS). */
  private async fetchToFile(song: Song): Promise<SavedSong> {
    await this.ready;
    if (!this.baseUri) throw new Error('no storage');
    const key = songKey(song);
    const path = `songs/${fileId(key)}.mp3`;
    const url = this.archive.songUrl(song);
    this.urlToKey.set(url, key);
    try {
      await FileTransfer.downloadFile({ url, path: `${this.baseUri}/${path}`, progress: true, connectTimeout: 20000, readTimeout: 60000 });
    } finally {
      this.urlToKey.delete(url);
    }
    const { size } = await Filesystem.stat({ directory: Directory.Data, path });
    if (size < MIN_BYTES) {
      await Filesystem.deleteFile({ directory: Directory.Data, path }).catch(() => undefined);
      throw new Error('not a song');
    }
    this.saveCover(song.itemId);
    return { song, path, bytes: size, savedAt: Date.now() };
  }

  /** Website: read through archive.org's /cors/ address and keep it in IndexedDB. */
  private async fetchToBrowser(song: Song): Promise<SavedSong> {
    const key = songKey(song);
    const res = await fetch(this.archive.corsUrl(song));
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const parts: BlobPart[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (total) {
        const p = Math.max(0.02, Math.min(0.99, got / total));
        if (p - (this.active()[key] ?? 0) >= 0.02) this.active.update(map => (key in map ? { ...map, [key]: p } : map));
      }
    }
    if (got < MIN_BYTES) throw new Error('not a song');
    const blob = new Blob(parts, { type: 'audio/mpeg' });
    await idb('put', key, blob);
    return { song, path: '', bytes: got, savedAt: Date.now() };
  }

  /** App: one cover per album, kept while any of its songs is saved. */
  private async saveCover(itemId: string): Promise<void> {
    const path = `covers/${fileId(itemId)}.jpg`;
    const exists = await Filesystem.stat({ directory: Directory.Data, path }).then(() => true, () => false);
    try {
      if (!exists) await FileTransfer.downloadFile({ url: this.archive.remoteThumbnailUrl(itemId), path: `${this.baseUri}/${path}` });
      this.archive.setLocalCover(itemId, this.native.fileSrc(`${this.baseUri}/${path}`));
    } catch {
      /* no cover: the list shows a plain tile */
    }
  }

  private forgetCoverIfUnused(itemId: string): void {
    if (this.saved().some(s => s.song.itemId === itemId)) return;
    this.archive.setLocalCover(itemId, null);
    if (this.native.isApp) Filesystem.deleteFile({ directory: Directory.Data, path: `covers/${fileId(itemId)}.jpg` }).catch(() => undefined);
  }

  private async deleteFile(entry: SavedSong): Promise<void> {
    const key = songKey(entry.song);
    if (this.native.isApp) {
      await Filesystem.deleteFile({ directory: Directory.Data, path: entry.path }).catch(() => undefined);
    } else {
      await idb('delete', key).catch(() => undefined);
      const url = this.blobUrls.get(key);
      if (url) { URL.revokeObjectURL(url); this.blobUrls.delete(key); }
    }
  }

  private persist(): void {
    this.storage.set(KEY, this.saved());
  }
}

/** Short, file-name-safe ID for a song or album. */
function fileId(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** Tiny IndexedDB helper for the website's saved songs. */
let dbPromise: Promise<IDBDatabase> | undefined;
function idb<T = unknown>(action: 'get' | 'put' | 'delete' | 'clear', key?: string, value?: Blob): Promise<T> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('cassette-fm', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('songs');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise.then(db => new Promise<T>((resolve, reject) => {
    const store = db.transaction('songs', action === 'get' ? 'readonly' : 'readwrite').objectStore('songs');
    const req = action === 'get' ? store.get(key!) : action === 'put' ? store.put(value, key) : action === 'delete' ? store.delete(key!) : store.clear();
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

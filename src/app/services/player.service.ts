import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { Song, songKey } from '../models/song.model';
import { Station } from '../models/station.model';
import { ArchiveService } from './archive.service';
import { LibraryService } from './library.service';
import { StorageService } from './storage.service';
import { ToastService } from './toast.service';

const KEY_VOLUME = 'osfm.vol';
/** Show "Tuning in…" only if a song takes longer than this to start. */
const TUNING_DELAY_MS = 1500;
/** Stop skipping after this many songs fail in a row (probably no internet). */
const MAX_SKIPS = 6;
/** What was playing, so a refresh can carry on from the same song and second. */
const KEY_RESUME = 'osfm.resume';
/** How often the playing position is saved while a song plays. */
const SAVE_EVERY_MS = 5000;

interface SavedPlayback {
  stationKey: string;
  /** Kept in full for an album opened from search, which isn't in the menu. */
  temporaryStation?: Station;
  song: Song;
  time: number;
  duration: number;
  shuffle: boolean;
}

/**
 * Plays the music. Wraps one HTML <audio> element and keeps the queue,
 * shuffle, history for "previous", and the phone's lock-screen controls.
 */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly archive = inject(ArchiveService);
  private readonly library = inject(LibraryService);
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  private readonly audio = new Audio();

  // ---- state the UI reads ----
  readonly current = signal<Song | null>(null);
  readonly isPlaying = signal(false);
  /** Song requested but not started yet (slow internet). */
  readonly isTuning = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly shuffle = signal(false);
  readonly volume = signal<number>(this.storage.get(KEY_VOLUME, 80));
  /** True once the visitor has pressed play at least once. */
  readonly started = signal(false);

  /** Playlist the current song comes from. */
  private readonly queueKey = signal('');
  readonly queueStation = computed(() => this.library.findStation(this.queueKey()));
  readonly progress = computed(() => (this.duration() ? this.currentTime() / this.duration() : 0));

  /** Playlist that should start as soon as its first songs arrive. */
  private readonly pendingStart = signal<string | null>(null);

  private index = -1;
  private history: string[] = [];
  private skips = 0;
  private wantPlay = false;
  private tuningTimer?: ReturnType<typeof setTimeout>;
  /** Second to jump to once a restored song is ready. */
  private resumeAt = 0;
  private lastSave = 0;

  constructor() {
    this.audio.preload = 'auto';
    this.audio.volume = this.volume() / 100;
    this.listenToAudio();
    this.setUpLockScreenControls();
    this.restore();

    // Save the exact position when the tab is closed, refreshed or hidden.
    addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });

    // Start a playlist the moment its first songs load.
    effect(() => {
      const key = this.pendingStart();
      if (!key) return;
      const songs = this.library.songsFor(key);
      const finished = this.library.isFinished(key);
      untracked(() => {
        if (songs.length) {
          this.pendingStart.set(null);
          this.playAt(key, this.shuffle() ? randomIndex(songs.length) : 0);
        } else if (finished) {
          this.pendingStart.set(null);
          this.setTuning(false);
          this.toast.show("Couldn't find songs for this playlist. Try another one.");
        }
      });
    });

    // Song details on the phone's lock screen.
    effect(() => {
      const song = this.current();
      if (!song || !('mediaSession' in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title, artist: song.artist, album: song.album || 'Cassette.fm',
        artwork: [{ src: this.archive.thumbnailUrl(song.itemId), sizes: '180x180' }],
      });
    });
  }

  /** Opens a playlist and plays it from the top (or a random song with shuffle on). */
  playStation(station: Station): void {
    this.library.select(station);
    this.queueKey.set(station.key);
    this.history = [];
    this.started.set(true);

    const songs = this.library.songsFor(station.key);
    if (songs.length) {
      this.playAt(station.key, this.shuffle() ? randomIndex(songs.length) : 0);
    } else if (station.isLiked) {
      // Nothing liked yet: just show the list, which explains how to add songs.
    } else {
      this.audio.pause();
      this.wantPlay = true;
      this.setTuning(true);
      this.pendingStart.set(station.key);
    }
  }

  /** Plays song number `index` of a playlist. */
  playAt(stationKey: string, index: number, fromHistory = false): void {
    const songs = this.library.songsFor(stationKey);
    if (!songs.length) return;
    if (stationKey !== this.queueKey()) this.history = [];

    const current = this.current();
    if (current && !fromHistory) {
      this.history.push(songKey(current));
      if (this.history.length > 50) this.history.shift();
    }

    this.pendingStart.set(null);
    this.queueKey.set(stationKey);
    this.index = (index + songs.length) % songs.length;
    const song = songs[this.index];
    this.current.set(song);
    this.started.set(true);

    this.resumeAt = 0;
    this.audio.preload = 'auto';
    this.audio.src = this.archive.songUrl(song);
    this.save();
    this.expectPlay();
    this.audio.play().catch(err => {
      if (err?.name === 'NotAllowedError') { this.setTuning(false); this.isPlaying.set(false); }
    });
  }

  togglePlay(): void {
    if (!this.current()) {
      this.playStation(this.library.selected());
      return;
    }
    if (!this.audio.paused) {
      this.wantPlay = false;
      this.setTuning(false);
      this.audio.pause();
    } else {
      this.expectPlay();
      this.audio.play().catch(() => undefined);
    }
  }

  next(): void {
    const songs = this.library.songsFor(this.queueKey());
    if (!songs.length) return;
    const at = this.currentIndex(songs);
    if (this.shuffle() && songs.length > 1) {
      let pick: number;
      do { pick = randomIndex(songs.length); } while (pick === at);
      this.playAt(this.queueKey(), pick);
    } else {
      this.playAt(this.queueKey(), at + 1);
    }
  }

  /** Restarts the song if it's past 4 seconds, otherwise goes back. */
  previous(): void {
    if (this.audio.currentTime > 4) { this.audio.currentTime = 0; return; }
    const songs = this.library.songsFor(this.queueKey());
    const lastKey = this.history.pop();
    const lastIndex = lastKey ? songs.findIndex(s => songKey(s) === lastKey) : -1;
    this.playAt(this.queueKey(), lastIndex >= 0 ? lastIndex : Math.max(this.currentIndex(songs), 0) - 1, true);
  }

  /** `fraction` from 0 to 1 */
  seekTo(fraction: number): void {
    if (isFinite(this.audio.duration)) this.audio.currentTime = this.audio.duration * fraction;
  }

  /** `percent` from 0 to 100 */
  setVolume(percent: number): void {
    this.volume.set(percent);
    this.audio.volume = percent / 100;
    this.storage.set(KEY_VOLUME, percent);
  }

  toggleShuffle(): void {
    this.shuffle.update(on => !on);
    this.save();
    this.toast.show(this.shuffle() ? 'Shuffle on' : 'Shuffle off');
  }

  isCurrent(song: Song): boolean {
    const current = this.current();
    return !!current && songKey(current) === songKey(song);
  }

  // ---- private ------------------------------------------------------------

  /**
   * Position of the current song in its playlist. After a refresh the playlist
   * may still be loading, so look the song up by its key rather than trusting a number.
   */
  private currentIndex(songs: Song[]): number {
    const current = this.current();
    if (!current) return -1;
    if (songs[this.index] && songKey(songs[this.index]) === songKey(current)) return this.index;
    this.index = songs.findIndex(s => songKey(s) === songKey(current));
    return this.index;
  }

  /** Remembers what's playing and where, in the visitor's browser. */
  private save(): void {
    const song = this.current();
    const station = this.queueStation();
    if (!song || !station) return;
    this.lastSave = Date.now();
    const saved: SavedPlayback = {
      stationKey: station.key,
      temporaryStation: station.isTemporary ? station : undefined,
      song,
      time: this.resumeAt || this.audio.currentTime || 0,
      duration: this.duration(),
      shuffle: this.shuffle(),
    };
    this.storage.set(KEY_RESUME, saved);
  }

  /**
   * After a refresh: show the last song, paused at the second it was left.
   * (Browsers don't allow sound before the visitor taps something, so one tap on play continues.)
   */
  private restore(): void {
    const saved = this.storage.get<SavedPlayback | null>(KEY_RESUME, null);
    if (!saved?.song?.itemId || !saved.stationKey) return;
    const station = saved.temporaryStation ?? this.library.findStation(saved.stationKey);
    if (!station) return;

    this.library.select(station);
    this.queueKey.set(station.key);
    this.current.set(saved.song);
    this.shuffle.set(!!saved.shuffle);
    this.started.set(true);
    this.currentTime.set(saved.time);
    this.duration.set(saved.duration);

    this.resumeAt = saved.time;
    this.audio.preload = 'metadata';
    this.audio.src = this.archive.songUrl(saved.song);
  }

  private listenToAudio(): void {
    const a = this.audio;
    a.addEventListener('playing', () => { this.skips = 0; this.wantPlay = false; this.isPlaying.set(true); this.setTuning(false); });
    a.addEventListener('play', () => this.isPlaying.set(true));
    // Changing songs fires "pause" too, so keep "Tuning in…" up while a song is wanted.
    a.addEventListener('pause', () => { this.isPlaying.set(false); if (!this.wantPlay) this.setTuning(false); this.save(); });
    // A restored song: jump to where the visitor left off.
    a.addEventListener('loadedmetadata', () => {
      if (this.resumeAt > 0 && this.resumeAt < a.duration) a.currentTime = this.resumeAt;
      this.resumeAt = 0;
    });
    a.addEventListener('waiting', () => { if (!a.paused) this.expectPlay(); });
    a.addEventListener('ended', () => this.next());
    a.addEventListener('timeupdate', () => {
      if (this.resumeAt) return; // keep showing the saved position until the jump happens
      this.currentTime.set(a.currentTime || 0);
      if (!a.paused && Date.now() - this.lastSave > SAVE_EVERY_MS) this.save();
    });
    a.addEventListener('durationchange', () => this.duration.set(isFinite(a.duration) ? a.duration : 0));
    a.addEventListener('error', () => this.onSongError());
  }

  private onSongError(): void {
    if (!this.current() || !this.audio.getAttribute('src')) return;
    if (++this.skips >= MAX_SKIPS) {
      this.skips = 0;
      this.setTuning(false);
      this.isPlaying.set(false);
      this.toast.show("These songs aren't loading. Check your internet or try another playlist.");
      return;
    }
    this.toast.show("Skipping a song that can't play");
    setTimeout(() => this.next(), 500);
  }

  private expectPlay(): void {
    this.wantPlay = true;
    clearTimeout(this.tuningTimer);
    this.tuningTimer = setTimeout(() => { if (this.wantPlay) this.setTuning(true); }, TUNING_DELAY_MS);
  }

  private setTuning(on: boolean): void {
    if (!on) clearTimeout(this.tuningTimer);
    this.isTuning.set(on);
  }

  private setUpLockScreenControls(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => this.audio.play().catch(() => undefined));
    navigator.mediaSession.setActionHandler('pause', () => this.audio.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    effect(() => { navigator.mediaSession.playbackState = this.isPlaying() ? 'playing' : 'paused'; });
  }
}

function randomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}

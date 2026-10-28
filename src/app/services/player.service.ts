import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { Song, songKey } from '../models/song.model';
import { Station, isLocalStation } from '../models/station.model';
import { ArchiveService } from './archive.service';
import { AudioFxService } from './audio-fx.service';
import { DownloadsService } from './downloads.service';
import { LibraryService } from './library.service';
import { NativeService } from './native.service';
import { SPACES, SettingsService } from './settings.service';
import { PLAY_COUNTS_AFTER_S } from './collections.service';
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
/** The sleep timer turns the music down over this long before stopping. */
const SLEEP_FADE_MS = 10000;

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
  private readonly downloads = inject(DownloadsService);
  private readonly native = inject(NativeService);
  private readonly settings = inject(SettingsService);
  private readonly fx = inject(AudioFxService);

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

  /** Sleep timer: when the music stops (ms timestamp), or null. */
  readonly sleepAt = signal<number | null>(null);
  /** Sleep timer set to "end of this song". */
  readonly sleepAfterSong = signal(false);
  /** Ticks every second while a sleep timer runs, for the countdown. */
  private readonly clock = signal(Date.now());
  readonly sleepMinutesLeft = computed(() => {
    const at = this.sleepAt();
    return at ? Math.max(1, Math.ceil((at - this.clock()) / 60000)) : 0;
  });

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
  /** This song's play was already counted. */
  private counted = false;
  private lastSave = 0;
  /** Changes with every song, so a slow-loading saved song can't replace a newer one. */
  private loadToken = 0;
  /** The song changed because the last one ended (fades only happen then). */
  private autoAdvance = false;
  private fadingIn = false;
  /** Song fade (0…1) and sleep-timer fade (0…1), multiplied with the volume. */
  private fade = 1;
  private sleepFade = 1;
  private sleepTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.audio.preload = 'auto';
    this.applyVolume();
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

    // Android app: the "Now playing" notification (it also keeps music going with the screen off).
    // Sent again when the song, play/pause or length changes; Android moves the seek bar on by itself.
    effect(() => {
      const song = this.current();
      const playing = this.isPlaying() || this.isTuning();
      const duration = Math.round(this.duration());
      if (song && this.started()) {
        this.native.nowPlaying(song.title, song.artist || song.album, playing, {
          position: untracked(() => this.audio.currentTime || 0), duration, artwork: this.archive.thumbnailUrl(song.itemId),
        });
      }
    });
    this.native.onNotificationButton((action, position) => {
      if (action === 'toggle') this.togglePlay();
      else if (action === 'next') this.next();
      else if (action === 'previous') this.previous();
      else if (action === 'seek' && position !== undefined && isFinite(this.audio.duration)) this.seekTo(position / this.audio.duration);
    });
    // Tell Android the new position after a seek, so the lock-screen seek bar jumps too.
    this.audio.addEventListener('seeked', () => {
      const song = this.current();
      if (song) this.native.nowPlaying(song.title, song.artist || song.album, !this.audio.paused, { position: this.audio.currentTime, duration: this.duration() });
    });

    // Equaliser / loudness levelling: switch Web Audio on the first time either is used.
    effect(() => {
      if (this.settings.needsAudioEffects()) untracked(() => this.enableEffects());
    });
    effect(() => {
      const gains = this.settings.eqGains();
      if (this.fx.active()) this.fx.setGains(gains);
    });
    effect(() => {
      const on = this.settings.evenLoudness();
      if (this.fx.active()) this.fx.setLevelling(on);
    });
    effect(() => {
      const s = this.settings;
      const [bass, treble, boost, width, balance, eightD, space] = [s.bass(), s.treble(), s.boost(), s.width(), s.balance(), s.eightD(), s.space()];
      if (!this.fx.active()) return;
      this.fx.setBass(bass);
      this.fx.setTreble(treble);
      this.fx.setBoost(boost);
      this.fx.setWidth(width);
      this.fx.setBalance(balance);
      this.fx.set8D(eightD);
      const room = SPACES.find(x => x.key === space) ?? SPACES[0];
      this.fx.setSpace(room.seconds, room.wet);
    });
    // Playback speed (keeps the singer's pitch).
    effect(() => {
      const speed = this.settings.speed();
      this.audio.preservesPitch = true;
      this.audio.defaultPlaybackRate = speed;
      this.audio.playbackRate = speed;
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
    } else if (isLocalStation(station)) {
      // Nothing in this list yet: just show it, it explains how to add songs.
    } else {
      this.audio.pause();
      this.wantPlay = true;
      this.setTuning(true);
      this.pendingStart.set(station.key);
    }
  }

  /**
   * Plays song number `index` of a playlist. Offline, it moves on (in `step` direction)
   * to the nearest downloaded song.
   */
  playAt(stationKey: string, index: number, fromHistory = false, step: 1 | -1 = 1): void {
    const songs = this.library.songsFor(stationKey);
    const auto = this.autoAdvance;
    this.autoAdvance = false;
    if (!songs.length) return;

    let at = (index + songs.length) % songs.length;
    if (!this.native.online() && !this.downloads.isDownloaded(songs[at])) {
      at = this.nearestDownloaded(songs, at, step);
      if (at < 0) {
        this.pendingStart.set(null);
        this.setTuning(false);
        this.audio.pause();
        this.toast.show("You're offline. Downloaded songs play without internet.", 3200);
        return;
      }
    }
    if (stationKey !== this.queueKey()) this.history = [];

    const current = this.current();
    if (current && !fromHistory) {
      this.history.push(songKey(current));
      if (this.history.length > 50) this.history.shift();
    }

    this.pendingStart.set(null);
    this.queueKey.set(stationKey);
    this.index = at;
    const song = songs[this.index];
    this.current.set(song);
    this.started.set(true);

    // "Fade between songs": the next song fades in only when the last one ended by itself.
    this.fadingIn = auto && this.settings.fadeSeconds() > 0;
    this.setFade(this.fadingIn ? 0 : 1);

    this.resumeAt = 0;
    this.audio.preload = 'auto';
    this.load(song, true);
    this.save();
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
      this.fx.resume();
      this.audio.play().catch(() => undefined);
    }
  }

  /** Pauses (used when another player starts: a preview, YouTube or Spotify). */
  pause(): void {
    this.wantPlay = false;
    this.setTuning(false);
    this.audio.pause();
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
    this.playAt(this.queueKey(), lastIndex >= 0 ? lastIndex : Math.max(this.currentIndex(songs), 0) - 1, true, -1);
  }

  /** `fraction` from 0 to 1 */
  seekTo(fraction: number): void {
    if (isFinite(this.audio.duration)) this.audio.currentTime = this.audio.duration * fraction;
  }

  /** `percent` from 0 to 100 */
  setVolume(percent: number): void {
    this.volume.set(percent);
    this.applyVolume();
    this.storage.set(KEY_VOLUME, percent);
  }

  /** Sleep timer: minutes from now, 'song' = at the end of this song, null = off. */
  setSleepTimer(choice: number | 'song' | null): void {
    clearInterval(this.sleepTimer);
    this.sleepFade = 1;
    this.applyVolume();
    this.sleepAfterSong.set(choice === 'song');
    this.sleepAt.set(typeof choice === 'number' ? Date.now() + choice * 60000 : null);
    this.clock.set(Date.now());
    if (typeof choice === 'number') {
      this.sleepTimer = setInterval(() => this.sleepTick(), 1000);
      this.toast.show(`Music stops in ${choice} minutes`);
    } else if (choice === 'song') {
      this.toast.show('Music stops after this song');
    } else {
      this.toast.show('Sleep timer off');
    }
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
    this.load(saved.song, false);
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
    a.addEventListener('ended', () => {
      if (this.sleepAfterSong()) {
        this.sleepAfterSong.set(false);
        this.wantPlay = false;
        this.toast.show('Goodnight 🌙 Sleep timer stopped the music.');
        return;
      }
      this.autoAdvance = true;
      this.next();
    });
    a.addEventListener('timeupdate', () => {
      if (this.resumeAt) return; // keep showing the saved position until the jump happens
      this.currentTime.set(a.currentTime || 0);
      this.updateSongFade();
      // Count a play (for smart playlists) once a song has really been listened to.
      if (!this.counted && a.currentTime >= PLAY_COUNTS_AFTER_S && this.current()) {
        this.counted = true;
        this.library.collections.recordPlay(this.current()!);
      }
      if (!a.paused && Date.now() - this.lastSave > SAVE_EVERY_MS) this.save();
    });
    a.addEventListener('durationchange', () => this.duration.set(isFinite(a.duration) ? a.duration : 0));
    a.addEventListener('error', () => this.onSongError());
  }

  /** Sets the audio source: the saved copy if there is one, otherwise archive.org. */
  private load(song: Song, play: boolean): void {
    const token = ++this.loadToken;
    this.counted = !play; // a song restored after a refresh was already counted
    const speed = this.settings.speed();
    const start = (src: string) => {
      this.audio.src = src;
      this.audio.playbackRate = speed;
      if (!play) return;
      this.expectPlay();
      this.fx.resume();
      this.audio.play().catch(err => {
        if (err?.name === 'NotAllowedError') { this.setTuning(false); this.isPlaying.set(false); }
      });
    };
    const now = this.downloads.srcNow(song);
    if (now || !this.downloads.isDownloaded(song)) {
      start(now ?? this.remoteUrl(song));
      return;
    }
    if (play) this.expectPlay();
    this.downloads.srcLater(song).then(src => { if (token === this.loadToken) start(src ?? this.remoteUrl(song)); });
  }

  /** With the equaliser on, songs must come through archive.org's /cors/ address. */
  private remoteUrl(song: Song): string {
    return this.fx.active() ? this.archive.corsUrl(song) : this.archive.songUrl(song);
  }

  private nearestDownloaded(songs: Song[], from: number, step: 1 | -1): number {
    for (let n = 0; n < songs.length; n++) {
      const i = (((from + n * step) % songs.length) + songs.length) % songs.length;
      if (this.downloads.isDownloaded(songs[i])) return i;
    }
    return -1;
  }

  private enableEffects(): void {
    if (this.fx.active()) return;
    this.audio.crossOrigin = 'anonymous';
    if (!this.fx.start(this.audio)) {
      this.audio.removeAttribute('crossorigin');
      this.toast.show("This phone's browser doesn't support the equaliser.");
      return;
    }
    this.fx.setGains(this.settings.eqGains());
    this.fx.setLevelling(this.settings.evenLoudness());
    this.applyVolume();

    // Reload the current song through the /cors/ address, at the same second.
    const song = this.current();
    if (!song || this.downloads.isDownloaded(song)) return;
    const wasPlaying = !this.audio.paused;
    this.resumeAt = this.audio.currentTime || this.resumeAt;
    this.audio.preload = 'auto';
    this.load(song, wasPlaying);
  }

  /** Fades the last seconds of a song out (and, after an automatic change, the first seconds in). */
  private updateSongFade(): void {
    const seconds = this.settings.fadeSeconds();
    const a = this.audio;
    if (!seconds || !isFinite(a.duration) || a.duration < seconds * 3) { this.setFade(1); return; }
    let fade = Math.min(1, Math.max(0, (a.duration - a.currentTime) / seconds));
    if (this.fadingIn) {
      if (a.currentTime >= seconds) this.fadingIn = false;
      else fade = Math.min(fade, a.currentTime / seconds);
    }
    this.setFade(fade);
  }

  private setFade(value: number): void {
    if (value === this.fade) return;
    this.fade = value;
    this.applyVolume();
  }

  private applyVolume(): void {
    const v = (this.volume() / 100) * this.fade * this.sleepFade;
    if (this.fx.active()) {
      this.audio.volume = 1;
      this.fx.setVolume(v);
    } else {
      this.audio.volume = Math.min(1, Math.max(0, v));
    }
  }

  private sleepTick(): void {
    const at = this.sleepAt();
    if (!at) return;
    const now = Date.now();
    this.clock.set(now);
    const left = at - now;
    if (left > SLEEP_FADE_MS) return;
    if (left > 0) {
      this.sleepFade = left / SLEEP_FADE_MS;
      this.applyVolume();
      return;
    }
    clearInterval(this.sleepTimer);
    this.sleepAt.set(null);
    this.wantPlay = false;
    this.audio.pause();
    this.sleepFade = 1;
    this.applyVolume();
    this.toast.show('Goodnight 🌙 Sleep timer stopped the music.');
  }

  private onSongError(): void {
    if (!this.current() || !this.audio.getAttribute('src')) return;
    if (!this.native.online() && !this.downloads.isDownloaded(this.current()!)) {
      // Lost internet mid-song: carry on with downloaded songs, if any.
      this.skips = 0;
      setTimeout(() => this.next(), 300);
      return;
    }
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

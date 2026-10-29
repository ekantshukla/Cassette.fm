import { Injectable, inject, signal } from '@angular/core';

import { SONG_BOT_URL } from '../data/app-info';
import { Song } from '../models/song.model';
import { LibraryService } from './library.service';
import { PlayerService } from './player.service';
import { SongFinderService } from './song-finder.service';

/** A song the AI thinks the listener means. */
export interface BotSong {
  title: string;
  film: string;
  artists: string;
  year: number | null;
  language: string;
  /** The official video, when the song finder found one (plays in YouTube's own player). */
  youtubeId?: string | null;
  /** A copy on the Internet Archive that plays right here (filled in by the app). */
  playable?: Song | null;
  /** Still looking it up on the Archive. */
  checking?: boolean;
}

export interface BotMessage {
  role: 'user' | 'assistant';
  text: string;
  songs?: BotSong[];
  /** The answer couldn't be fetched. */
  error?: boolean;
}

/** Free, legal places to listen, opened outside the app. */
export const FREE_SERVICES = [
  { name: 'YouTube', url: (q: string) => `https://www.youtube.com/results?search_query=${q}` },
  { name: 'JioSaavn', url: (q: string) => `https://www.jiosaavn.com/search/song/${q}` },
  { name: 'Spotify', url: (q: string) => `https://open.spotify.com/search/${q}` },
  { name: 'YouTube Music', url: (q: string) => `https://music.youtube.com/search?q=${q}` },
  { name: 'Gaana', url: (q: string) => `https://gaana.com/search/${q}` },
  { name: 'Apple Music', url: (q: string) => `https://music.apple.com/in/search?term=${q}` },
];

/**
 * Cassette AI: a chat that finds a song from a rough description, then offers the ways to hear it:
 *  1. play it here, from the Internet Archive (where the app's songs come from)
 *  2. play the official video here, in YouTube's own player
 *  3. open it free on YouTube, JioSaavn, Spotify, Gaana or Apple Music
 * The AI runs in your Cloudflare Worker (SONG_BOT_URL). Without it the chat still searches the Archive.
 */
@Injectable({ providedIn: 'root' })
export class SongBotService {
  private readonly library = inject(LibraryService);
  private readonly player = inject(PlayerService);
  private readonly finder = inject(SongFinderService);

  readonly aiAvailable = !!SONG_BOT_URL;
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly messages = signal<BotMessage[]>([]);

  /** Opens the chat, optionally asking straight away (e.g. what the listener typed in search). */
  start(question = ''): void {
    this.open.set(true);
    if (question.trim() && !this.busy()) this.ask(question);
  }

  async ask(text: string): Promise<void> {
    const message = text.trim().slice(0, 500);
    if (!message || this.busy()) return;
    const history = this.messages().filter(m => !m.error).slice(-6).map(m => ({ role: m.role, content: m.text }));
    this.messages.update(list => [...list, { role: 'user', text: message }]);
    this.busy.set(true);
    try {
      const answer = this.aiAvailable ? await this.askAi(message, history) : this.withoutAi(message);
      const reply: BotMessage = { role: 'assistant', text: answer.reply, songs: answer.songs.map(s => ({ ...s, checking: true })) };
      this.messages.update(list => [...list, reply]);
      this.findPlayable(reply);
    } catch {
      this.messages.update(list => [...list, {
        role: 'assistant', error: true,
        text: "I couldn't reach the song finder just now. Check your internet and try again, or use the links below.",
        songs: [this.guess(message)],
      }]);
    } finally {
      this.busy.set(false);
    }
  }

  clear(): void {
    this.messages.set([]);
  }

  /** Plays the Archive copy right here, as a one-song list (so Next carries on with the AI's other picks). */
  play(message: BotMessage, song: BotSong): void {
    const songs = (message.songs ?? []).map(s => s.playable).filter((s): s is Song => !!s);
    const start = songs.findIndex(s => s === song.playable);
    if (start < 0) return;
    const key = `bot:${Date.now().toString(36)}`;
    this.library.showSongs({ key, group: 'Search', name: 'Found by AI', subtitle: song.title, mark: '✦', color: '#9B59FF' }, songs);
    this.player.playAt(key, start);
  }

  query(song: BotSong): string {
    return encodeURIComponent(`${song.title} ${song.film || song.artists}`.trim());
  }

  // ---- private -------------------------------------------------------------

  private async askAi(message: string, history: Array<{ role: string; content: string }>): Promise<{ reply: string; songs: BotSong[] }> {
    const language = this.library.language();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 25000);
    try {
      const res = await fetch(SONG_BOT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, language: language.name, industry: language.industry }),
        signal: abort.signal,
      });
      if (res.status === 429) return { reply: "That's a lot of questions at once. Give me a minute and ask again.", songs: [] };
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { reply?: string; songs?: BotSong[] };
      return { reply: data.reply || 'Here is what I found.', songs: (data.songs ?? []).slice(0, 5) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** No AI set up: treat the message as the song's name and still look for it. */
  private withoutAi(message: string): { reply: string; songs: BotSong[] } {
    return { reply: `Looking for “${message}”. (The AI song finder isn't switched on yet, so I'm searching by name.)`, songs: [this.guess(message)] };
  }

  private guess(message: string): BotSong {
    return { title: message, film: '', artists: '', year: null, language: '' };
  }

  /** Looks each suggestion up on the Internet Archive, a few at a time, and marks the ones that can play here. */
  private async findPlayable(message: BotMessage): Promise<void> {
    const songs = message.songs ?? [];
    await Promise.all(songs.map(async song => {
      const found = await this.finder.find({ title: song.title, artist: song.artists || undefined, film: song.film || undefined }).catch(() => null);
      song.playable = found;
      song.checking = false;
      this.messages.update(list => [...list]); // redraw this answer
    }));
  }
}

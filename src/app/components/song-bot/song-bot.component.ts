import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { NativeService } from '../../services/native.service';
import { PlayerService } from '../../services/player.service';
import { BotMessage, BotSong, FREE_SERVICES, SongBotService } from '../../services/song-bot.service';
import { openExternal } from '../../services/spotify.service';
import { UiService } from '../../services/ui.service';
import { VoiceSearchService } from '../../services/voice-search.service';
import { IconComponent } from '../icon/icon.component';

/** Example questions shown before the first message. */
const EXAMPLES = [
  'The rain song from Mohra',
  'Arijit Singh song from Aashiqui 2',
  'Sad 90s song, Kumar Sanu, about a letter',
  'Tamil song from Jailer that went viral',
];

/**
 * Cassette AI: the floating song-finder bot (round button bottom-right, opens a chat window).
 * Chat: describe a song however you remember it; get the song, then play it here
 * (Internet Archive), watch the official video here (YouTube's player), or open it free elsewhere.
 */
@Component({
  selector: 'app-song-bot',
  imports: [IconComponent],
  templateUrl: './song-bot.component.html',
  styleUrl: './song-bot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
})
export class SongBotComponent {
  protected readonly bot = inject(SongBotService);
  protected readonly voice = inject(VoiceSearchService);
  private readonly native = inject(NativeService);
  private readonly player = inject(PlayerService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly ui = inject(UiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly examples = EXAMPLES;
  protected readonly services = FREE_SERVICES;
  protected readonly draft = signal('');
  /** The official video playing inside the chat (YouTube's own player, visible). */
  protected readonly video = signal<{ id: string; url: SafeResourceUrl; title: string } | null>(null);

  constructor() {
    this.watchMiniPlayer();
    // Keep the newest message in view.
    effect(() => {
      this.bot.messages();
      this.bot.busy();
      setTimeout(() => {
        const list = this.host.nativeElement.querySelector('.chat');
        list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      }, 30);
    });
    effect(() => {
      if (this.bot.open()) setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.ask input')?.focus(), 120);
      else this.video.set(null); // closing the chat stops the video (YouTube's rules: no background play)
    });
  }

  close(): void {
    if (this.voice.listening()) this.voice.stop();
    this.bot.open.set(false);
  }

  /** The button sits just above the bottom bar, and stays above the mini player whenever that shows. */
  protected readonly lift = signal(false);

  private watchMiniPlayer(): void {
    if (typeof window === 'undefined') return;
    const check = () => this.lift.set(!!document.querySelector('app-mini-player') && window.innerWidth <= 900);
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', check);
    check();
  }

  /** The speech bubble next to the button shows until the listener opens the chat once. */
  protected readonly seen = signal(this.readSeen());

  protected toggle(): void {
    if (this.bot.open()) { this.close(); return; }
    this.bot.start();
    this.seen.set(true);
    try { localStorage.setItem('cfm.bot.seen', '1'); } catch { /* storage blocked */ }
  }

  private readSeen(): boolean {
    try { return localStorage.getItem('cfm.bot.seen') === '1'; } catch { return true; }
  }

  protected send(): void {
    const text = this.draft();
    if (!text.trim()) return;
    this.draft.set('');
    this.bot.ask(text);
  }

  protected speak(): void {
    this.voice.listen((text, final) => {
      this.draft.set(text);
      if (final) this.send();
    }).catch(() => undefined);
  }

  protected play(message: BotMessage, song: BotSong): void {
    this.video.set(null);
    this.bot.play(message, song);
  }

  protected watch(song: BotSong): void {
    if (!song.youtubeId) return;
    this.player.pause();
    const id = encodeURIComponent(song.youtubeId);
    this.video.set({
      id: song.youtubeId, title: song.title,
      url: this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`),
    });
  }

  protected openService(url: string): void {
    openExternal(url, this.native.isApp);
  }

  protected link(service: { url: (q: string) => string }, song: BotSong): string {
    return service.url(this.bot.query(song));
  }

  protected details(song: BotSong): string {
    return [song.film, song.artists, song.year].filter(Boolean).join(' · ');
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

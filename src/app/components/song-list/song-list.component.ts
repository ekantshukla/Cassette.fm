import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal } from '@angular/core';

import { Song, songKey } from '../../models/song.model';
import { ArchiveService } from '../../services/archive.service';
import { AVERAGE_SONG_BYTES, DownloadsService } from '../../services/downloads.service';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { ToastService } from '../../services/toast.service';
import { UiService } from '../../services/ui.service';
import { USER_PREFIX } from '../../services/collections.service';
import { formatBytes } from '../../utils/text.utils';
import { DownloadButtonComponent } from '../download-button/download-button.component';
import { IconComponent } from '../icon/icon.component';

/** Downloading more songs than this at once asks for a second tap first. */
const CONFIRM_ABOVE = 25;

/** Songs of the open playlist. Tap a row to play it, tap ♥ to like it. */
@Component({
  selector: 'app-song-list',
  imports: [DownloadButtonComponent, IconComponent],
  templateUrl: './song-list.component.html',
  styleUrl: './song-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'menuFor.set(null)', '(document:keydown.escape)': 'menuFor.set(null)' },
})
export class SongListComponent {
  protected readonly library = inject(LibraryService);
  protected readonly player = inject(PlayerService);
  private readonly archive = inject(ArchiveService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly downloads = inject(DownloadsService);
  private readonly ui = inject(UiService);
  /** Song whose ⋯ menu is open. */
  protected readonly menuFor = signal<string | null>(null);

  protected readonly songKey = songKey;
  protected readonly placeholders = Array.from({ length: 7 });

  protected readonly station = this.library.selected;
  protected readonly songs = computed(() => this.library.songsFor(this.station().key));
  protected readonly loading = computed(() => this.library.isLoading(this.station().key));
  protected readonly finished = computed(() => this.library.isFinished(this.station().key));
  protected readonly heading = computed(() => (this.station().isLiked ? 'Liked songs' : this.station().name));

  protected toggleMenu(event: Event, song: Song): void {
    event.stopPropagation();
    this.menuFor.set(this.menuFor() === songKey(song) ? null : songKey(song));
  }

  protected addOne(song: Song): void {
    this.menuFor.set(null);
    this.ui.addToPlaylist.set([song]);
  }

  protected addAll(): void {
    this.ui.addToPlaylist.set([...this.songs()]);
  }

  protected move(song: Song, step: -1 | 1): void {
    this.library.collections.moveSong(this.station().key.slice(USER_PREFIX.length), song, step);
  }

  protected removeFromPlaylist(song: Song): void {
    this.menuFor.set(null);
    this.library.collections.removeSong(this.station().key.slice(USER_PREFIX.length), song);
    this.toast.show(`Removed from ${this.station().name}`);
  }

  protected plays(song: Song): number {
    return this.library.collections.playCount(song);
  }

  /** "Download all" in the playlist header: what it says and does right now. */
  protected readonly confirming = signal(false);
  private confirmTimer?: ReturnType<typeof setTimeout>;
  protected readonly downloadAction = computed<{ kind: 'save' | 'busy' | 'done'; label: string } | null>(() => {
    const songs = this.songs();
    if (!songs.length || this.station().isDownloads) return null;
    const missing = songs.filter(s => this.downloads.stateOf(s) !== 'done');
    const busy = missing.filter(s => this.downloads.stateOf(s) !== 'none').length;
    if (!missing.length) return { kind: 'done', label: 'Downloaded' };
    if (busy) return { kind: 'busy', label: `Saving ${busy}… · Stop` };
    if (this.confirming()) return { kind: 'save', label: `Download ${missing.length} songs? ~${formatBytes(missing.length * AVERAGE_SONG_BYTES)}` };
    return { kind: 'save', label: missing.length === songs.length ? 'Download' : `Download ${missing.length} more` };
  });

  protected readonly countText = computed(() => {
    const n = this.songs().length;
    if (this.station().isDownloads && n) return `${n} ${n === 1 ? 'SONG' : 'SONGS'} · ${formatBytes(this.downloads.totalBytes())}`;
    const count = n ? `${n} ${n === 1 ? 'SONG' : 'SONGS'}` : '';
    if (!this.loading()) return count;
    // Hand-picked lists (Nostalgic Long Drive) show how far the lookup has got.
    const progress = this.library.progressFor(this.station().key);
    const status = progress ? `FINDING ${progress.done} / ${progress.total}` : 'LOADING…';
    return count ? `${count} · ${status}` : status;
  });

  constructor() {
    // Keep the playing song in view on desktop.
    effect(() => {
      if (!this.player.current()) return;
      setTimeout(() => {
        if (window.innerWidth <= 900) return;
        this.host.nativeElement.querySelector('.row.current')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });
  }

  protected thumb(song: Song): string {
    return `url('${this.archive.thumbnailUrl(song.itemId)}')`;
  }

  protected play(index: number): void {
    this.player.playAt(this.station().key, index);
  }

  protected onDownloadAll(): void {
    const action = this.downloadAction();
    if (!action || action.kind === 'done') return;
    if (action.kind === 'busy') { this.downloads.cancelWaiting(); return; }
    const missing = this.songs().filter(s => this.downloads.stateOf(s) === 'none');
    if (missing.length > CONFIRM_ABOVE && !this.confirming()) {
      this.confirming.set(true);
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.confirming.set(false), 4000);
      return;
    }
    this.confirming.set(false);
    this.downloads.download(missing);
  }

  protected toggleLike(event: Event, song: Song): void {
    event.stopPropagation();
    this.toast.show(this.library.toggleLike(song) ? 'Saved to Liked ♥' : 'Removed from Liked');
  }
}

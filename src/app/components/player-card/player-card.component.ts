import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { ArchiveService } from '../../services/archive.service';
import { DownloadsService } from '../../services/downloads.service';
import { SettingsService } from '../../services/settings.service';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { ToastService } from '../../services/toast.service';
import { UiService } from '../../services/ui.service';
import { formatTime } from '../../utils/text.utils';
import { IconComponent } from '../icon/icon.component';

/** The big "now playing" card: spinning record, song name, controls. */
@Component({
  selector: 'app-player-card',
  imports: [IconComponent],
  templateUrl: './player-card.component.html',
  styleUrl: './player-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerCardComponent {
  protected readonly player = inject(PlayerService);
  private readonly library = inject(LibraryService);
  private readonly archive = inject(ArchiveService);
  private readonly toast = inject(ToastService);
  private readonly ui = inject(UiService);
  protected readonly settings = inject(SettingsService);
  private readonly downloads = inject(DownloadsService);

  // ---- Download button under the song name
  protected readonly dlState = computed(() => { const s = this.song(); return s ? this.downloads.stateOf(s) : 'none'; });
  protected readonly dlProgress = computed(() => { const s = this.song(); return s ? this.downloads.progressOf(s) : 0; });
  private readonly confirmRemove = signal(false);
  protected readonly dlLabel = computed(() => {
    switch (this.dlState()) {
      case 'queued': return 'Waiting…';
      case 'downloading': return `Downloading ${Math.round(this.dlProgress() * 100)}%`;
      case 'done': return this.confirmRemove() ? 'Tap again to remove' : 'Downloaded · plays offline';
      default: return 'Download song';
    }
  });

  protected onDownload(): void {
    const song = this.song();
    if (!song) return;
    const state = this.dlState();
    if (state === 'none') { this.downloads.download([song]); return; }
    if (state !== 'done') return;
    if (!this.confirmRemove()) {
      this.confirmRemove.set(true);
      setTimeout(() => this.confirmRemove.set(false), 3000);
      return;
    }
    this.confirmRemove.set(false);
    this.downloads.remove(song);
    this.toast.show('Removed from downloads');
  }

  /** While the visitor drags the seek bar, show their position instead of the song's. */
  private readonly dragPercent = signal<number | null>(null);

  protected readonly song = this.player.current;
  protected readonly isLiked = computed(() => this.library.isLiked(this.song()));
  protected readonly sleepOn = computed(() => !!this.player.sleepAt() || this.player.sleepAfterSong());
  protected readonly spinning = computed(() => this.player.isPlaying() && !this.player.isTuning());

  protected readonly stationName = computed(() => {
    const station = this.song() ? this.player.queueStation() : this.library.selected();
    return station?.isLiked ? 'Liked songs' : (station?.name ?? '');
  });

  /** Record label: album cover over the playlist colour. */
  protected readonly labelBackground = computed(() => {
    const song = this.song();
    const color = (this.player.queueStation() ?? this.library.selected()).color;
    return song ? `${color} url('${this.archive.thumbnailUrl(song.itemId)}') center / cover no-repeat` : color;
  });

  protected readonly seekPercent = computed(() => this.dragPercent() ?? this.player.progress() * 100);
  protected readonly elapsed = computed(() => formatTime(this.player.currentTime()));
  protected readonly total = computed(() => formatTime(this.player.duration()));

  protected onSeekInput(value: string): void {
    this.dragPercent.set(Number(value) / 10);
  }

  protected onSeekChange(value: string): void {
    this.dragPercent.set(null);
    this.player.seekTo(Number(value) / 1000);
  }

  protected addToPlaylist(): void {
    const song = this.song();
    if (song) this.ui.addToPlaylist.set([song]);
  }

  protected toggleLike(): void {
    const song = this.song();
    if (!song) return;
    this.toast.show(this.library.toggleLike(song) ? 'Saved to Liked ♥' : 'Removed from Liked');
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { ArchiveService } from '../../services/archive.service';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { ToastService } from '../../services/toast.service';
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

  /** While the visitor drags the seek bar, show their position instead of the song's. */
  private readonly dragPercent = signal<number | null>(null);

  protected readonly song = this.player.current;
  protected readonly isLiked = computed(() => this.library.isLiked(this.song()));
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

  protected toggleLike(): void {
    const song = this.song();
    if (!song) return;
    this.toast.show(this.library.toggleLike(song) ? 'Saved to Liked ♥' : 'Removed from Liked');
  }
}

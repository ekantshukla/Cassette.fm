import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject } from '@angular/core';

import { Song, songKey } from '../../models/song.model';
import { ArchiveService } from '../../services/archive.service';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../icon/icon.component';

/** Songs of the open playlist. Tap a row to play it, tap ♥ to like it. */
@Component({
  selector: 'app-song-list',
  imports: [IconComponent],
  templateUrl: './song-list.component.html',
  styleUrl: './song-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SongListComponent {
  protected readonly library = inject(LibraryService);
  protected readonly player = inject(PlayerService);
  private readonly archive = inject(ArchiveService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly songKey = songKey;
  protected readonly placeholders = Array.from({ length: 7 });

  protected readonly station = this.library.selected;
  protected readonly songs = computed(() => this.library.songsFor(this.station().key));
  protected readonly loading = computed(() => this.library.isLoading(this.station().key));
  protected readonly finished = computed(() => this.library.isFinished(this.station().key));
  protected readonly heading = computed(() => (this.station().isLiked ? 'Liked songs' : this.station().name));

  protected readonly countText = computed(() => {
    const n = this.songs().length;
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

  protected toggleLike(event: Event, song: Song): void {
    event.stopPropagation();
    this.toast.show(this.library.toggleLike(song) ? 'Saved to Liked ♥' : 'Removed from Liked');
  }
}

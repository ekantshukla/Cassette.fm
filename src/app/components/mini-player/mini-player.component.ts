import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ArchiveService } from '../../services/archive.service';
import { PlayerService } from '../../services/player.service';
import { IconComponent } from '../icon/icon.component';

/** Small player stuck to the bottom on phones once the big card scrolls away. */
@Component({
  selector: 'app-mini-player',
  imports: [IconComponent],
  templateUrl: './mini-player.component.html',
  styleUrl: './mini-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiniPlayerComponent {
  protected readonly player = inject(PlayerService);
  private readonly archive = inject(ArchiveService);

  protected readonly song = this.player.current;
  protected readonly cover = computed(() => {
    const song = this.song();
    return song ? `url('${this.archive.thumbnailUrl(song.itemId)}')` : 'none';
  });
  protected readonly subtitle = computed(() => (this.player.isTuning() ? 'Tuning in…' : (this.song()?.artist ?? '')));
}

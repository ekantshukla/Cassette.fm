import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output } from '@angular/core';

import { APK_URL } from '../../data/app-info';
import { DOWNLOADS_STATION, LIKED_STATION } from '../../data/stations';
import { Station } from '../../models/station.model';
import { DownloadsService } from '../../services/downloads.service';
import { NativeService } from '../../services/native.service';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { IconComponent } from '../icon/icon.component';

/** The menu that slides in from the right with every playlist, grouped. */
@Component({
  selector: 'app-playlist-drawer',
  imports: [IconComponent],
  templateUrl: './playlist-drawer.component.html',
  styleUrl: './playlist-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close.emit()' },
})
export class PlaylistDrawerComponent {
  protected readonly library = inject(LibraryService);
  protected readonly downloads = inject(DownloadsService);
  protected readonly native = inject(NativeService);
  protected readonly mine = [LIKED_STATION, DOWNLOADS_STATION];
  protected readonly apkUrl = APK_URL;
  private readonly player = inject(PlayerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = input(false);
  readonly close = output<void>();

  constructor() {
    // Move keyboard focus to the open playlist when the menu opens.
    effect(() => {
      if (!this.open()) return;
      setTimeout(() => {
        const el = this.host.nativeElement;
        (el.querySelector<HTMLElement>('.item[aria-current="true"]') ?? el.querySelector<HTMLElement>('.item'))?.focus();
      }, 50);
    });
  }

  protected pick(station: Station): void {
    this.close.emit();
    this.player.playStation(station);
    document.querySelector('app-player-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

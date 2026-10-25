import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Station } from '../../models/station.model';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';

/** Playlist buttons under the headline (desktop only; phones use the menu). */
@Component({
  selector: 'app-station-chips',
  templateUrl: './station-chips.component.html',
  styleUrl: './station-chips.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationChipsComponent {
  protected readonly library = inject(LibraryService);
  private readonly player = inject(PlayerService);

  protected pick(station: Station): void {
    this.player.playStation(station);
  }
}

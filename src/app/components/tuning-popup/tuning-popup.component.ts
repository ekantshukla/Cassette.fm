import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { PlayerService } from '../../services/player.service';

/** "Tuning in…" card, shown only when a song is slow to start. Closes by itself. */
@Component({
  selector: 'app-tuning-popup',
  templateUrl: './tuning-popup.component.html',
  styleUrl: './tuning-popup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TuningPopupComponent {
  protected readonly player = inject(PlayerService);
}

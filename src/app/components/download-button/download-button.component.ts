import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { Song } from '../../models/song.model';
import { DownloadsService } from '../../services/downloads.service';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../icon/icon.component';

/**
 * Download one song for listening offline. Shows a progress ring while it downloads.
 * Tapping a downloaded song twice removes the download.
 */
@Component({
  selector: 'app-download-button',
  imports: [IconComponent],
  templateUrl: './download-button.component.html',
  styleUrl: './download-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadButtonComponent {
  private readonly downloads = inject(DownloadsService);
  private readonly toast = inject(ToastService);

  readonly song = input.required<Song>();

  protected readonly state = computed(() => this.downloads.stateOf(this.song()));
  protected readonly progress = computed(() => this.downloads.progressOf(this.song()));
  /** Ring: circumference 2πr with r = 9 */
  protected readonly dash = computed(() => `${Math.max(0.04, this.progress()) * 56.5} 56.5`);
  protected readonly label = computed(() => ({
    none: 'Download for offline', queued: 'Waiting to download', downloading: 'Downloading', done: 'Downloaded. Tap twice to remove',
  })[this.state()]);

  private readonly armed = signal(false);
  private armTimer?: ReturnType<typeof setTimeout>;

  protected onClick(event: Event): void {
    event.stopPropagation();
    const state = this.state();
    if (state === 'none') {
      this.downloads.download([this.song()]);
    } else if (state === 'done') {
      if (this.armed()) {
        clearTimeout(this.armTimer);
        this.armed.set(false);
        this.downloads.remove(this.song());
        this.toast.show('Removed from downloads');
      } else {
        this.armed.set(true);
        this.toast.show('Tap again to remove this download');
        this.armTimer = setTimeout(() => this.armed.set(false), 3000);
      }
    }
  }
}

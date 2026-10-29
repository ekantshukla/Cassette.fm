import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { LANGUAGES, Language } from '../../data/languages';
import { isLocalStation } from '../../models/station.model';
import { PlayerService } from '../../services/player.service';
import { LibraryService } from '../../services/library.service';
import { ToastService } from '../../services/toast.service';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../icon/icon.component';

/**
 * The list of music languages. Desktop: a panel under the header switch.
 * Phones: a sheet sliding up from the bottom.
 * Drawn at page level (not inside the header) so it can cover the whole screen.
 */
@Component({
  selector: 'app-language-panel',
  imports: [IconComponent],
  templateUrl: './language-panel.component.html',
  styleUrl: './language-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
})
export class LanguagePanelComponent {
  protected readonly library = inject(LibraryService);
  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);
  private readonly player = inject(PlayerService);

  protected readonly sections = [
    { name: 'Popular', languages: LANGUAGES.filter(l => !l.regional) },
    { name: 'Regional', languages: LANGUAGES.filter(l => l.regional) },
  ];

  protected close(): void {
    this.ui.languageOpen.set(false);
  }

  /**
   * Picking a language (even the same one again) always refreshes: the playlists switch to that
   * language, its first playlist opens and loads, and if music was playing it carries on in the new language.
   */
  protected pick(language: Language): void {
    this.close();
    const same = language.code === this.library.language().code;
    if (!same) this.library.setLanguage(language);
    const first = this.library.stations()[0];
    // Downloads, Liked and your own playlists aren't tied to a language: go to the language's playlists.
    const current = this.library.selected();
    const target = same && !isLocalStation(current) ? current : first;
    if (this.player.isPlaying() || this.player.isTuning()) {
      this.player.playStation(target);
    } else {
      this.library.refresh(target);
    }
    this.toast.show(same ? `Refreshing ${language.name} playlists` : `Now playing ${language.name} playlists`);
    setTimeout(() => document.querySelector('app-song-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
}

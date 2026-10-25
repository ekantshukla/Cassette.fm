import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { LANGUAGES, Language } from '../../data/languages';
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

  protected readonly languages = LANGUAGES;

  protected close(): void {
    this.ui.languageOpen.set(false);
  }

  protected pick(language: Language): void {
    this.close();
    if (language.code === this.library.language().code) return;
    this.library.setLanguage(language);
    this.toast.show(`Now showing ${language.name} playlists`);
  }
}

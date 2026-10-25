import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { LibraryService } from '../../services/library.service';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../icon/icon.component';

/**
 * The music-language switch in the header.
 * Desktop: a pill with the current language ("हिन्दी ▾"). Phones: just a globe.
 * It opens <app-language-panel>, which is drawn at page level (see app.component.html).
 */
@Component({
  selector: 'app-language-picker',
  imports: [IconComponent],
  templateUrl: './language-picker.component.html',
  styleUrl: './language-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguagePickerComponent {
  protected readonly library = inject(LibraryService);
  protected readonly ui = inject(UiService);
}

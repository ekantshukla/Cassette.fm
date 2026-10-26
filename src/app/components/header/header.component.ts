import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { PlayerService } from '../../services/player.service';
import { AccountService } from '../../services/account.service';
import { SettingsService } from '../../services/settings.service';
import { IconComponent } from '../icon/icon.component';
import { LanguagePickerComponent } from '../language-picker/language-picker.component';
import { SearchBoxComponent } from '../search-box/search-box.component';

/** Sticky top bar: logo, search, "On air" light and the menu button. */
@Component({
  selector: 'app-header',
  imports: [IconComponent, LanguagePickerComponent, SearchBoxComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  protected readonly player = inject(PlayerService);
  protected readonly settings = inject(SettingsService);
  protected readonly account = inject(AccountService);

  readonly menuOpen = input(false);
  readonly menuClick = output<void>();

  protected readonly liveText = computed(() => {
    if (this.player.isTuning()) return 'Tuning in';
    if (this.player.isPlaying()) return 'On air';
    return this.player.started() ? 'Paused' : 'Tap play';
  });
}

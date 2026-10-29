import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { DOWNLOADS_STATION } from '../../data/stations';
import { DownloadsService } from '../../services/downloads.service';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { SettingsService } from '../../services/settings.service';
import { UiService } from '../../services/ui.service';
import { IconComponent, IconName } from '../icon/icon.component';

type Tab = 'home' | 'latest' | 'library' | 'language' | 'downloads' | 'settings';

/**
 * Phones (the Android app and mobile browsers): the bar at the bottom of the screen, like Spotify.
 * Home · Latest · Library · Language · Downloads · Settings. Search and the profile stay in the top bar.
 * Hidden on wider screens, where the header has room for everything.
 */
@Component({
  selector: 'app-bottom-nav',
  imports: [IconComponent],
  template: `
    <nav class="bar" aria-label="Main">
      @for (t of tabs; track t.key) {
        <button type="button" [class.on]="active() === t.key" [attr.aria-current]="active() === t.key ? 'page' : null" (click)="go(t.key)">
          <app-icon [name]="t.icon" />
          @if (t.key === 'downloads' && downloads.count()) { <i class="n">{{ downloads.count() }}</i> }
          <span [attr.lang]="t.key === 'language' ? library.language().code : null">{{ t.key === 'language' ? library.language().native : t.name }}</span>
        </button>
      }
    </nav>
  `,
  styleUrl: './bottom-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomNavComponent {
  private readonly ui = inject(UiService);
  private readonly settings = inject(SettingsService);
  protected readonly library = inject(LibraryService);
  private readonly player = inject(PlayerService);
  protected readonly downloads = inject(DownloadsService);

  protected readonly tabs: Array<{ key: Tab; name: string; icon: IconName }> = [
    { key: 'home', name: 'Home', icon: 'home' },
    { key: 'latest', name: 'Latest', icon: 'spark' },
    { key: 'library', name: 'Library', icon: 'library' },
    { key: 'language', name: 'Language', icon: 'globe' },
    { key: 'downloads', name: 'Offline', icon: 'downloaded' },
    { key: 'settings', name: 'Settings', icon: 'settings' },
  ];

  protected readonly active = computed<Tab>(() => {
    if (this.settings.open()) return 'settings';
    if (this.ui.menuOpen()) return 'library';
    if (this.ui.latestOpen()) return 'latest';
    if (this.ui.languageOpen()) return 'language';
    if (this.library.selected().isDownloads) return 'downloads';
    return 'home';
  });

  protected go(tab: Tab): void {
    const again = this.active() === tab;
    // One screen at a time.
    this.settings.open.set(false);
    this.ui.menuOpen.set(false);
    this.ui.latestOpen.set(false);
    this.ui.languageOpen.set(false);
    this.ui.searchOpen.set(false);

    if (tab === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (tab === 'downloads') {
      this.player.playStation(DOWNLOADS_STATION);
      setTimeout(() => document.querySelector('app-song-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }
    if (again) return; // tapping the open tab again closes it (back to Home)
    if (tab === 'language') this.ui.languageOpen.set(true);
    if (tab === 'latest') this.ui.latestOpen.set(true);
    if (tab === 'library') { this.ui.menuTab.set('library'); this.ui.menuOpen.set(true); }
    if (tab === 'settings') this.settings.openAt();
  }
}

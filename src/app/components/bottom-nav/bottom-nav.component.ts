import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { SettingsService } from '../../services/settings.service';
import { UiService } from '../../services/ui.service';
import { IconComponent, IconName } from '../icon/icon.component';

type Tab = 'home' | 'search' | 'latest' | 'library' | 'settings';

/**
 * Phones (the Android app and mobile browsers): the bar at the bottom of the screen, like Spotify.
 * Home · Search · Latest · Library · Settings. The top bar keeps only the logo and the profile.
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
          <span>{{ t.name }}</span>
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

  protected readonly tabs: Array<{ key: Tab; name: string; icon: IconName }> = [
    { key: 'home', name: 'Home', icon: 'home' },
    { key: 'search', name: 'Search', icon: 'search' },
    { key: 'latest', name: 'Latest', icon: 'spark' },
    { key: 'library', name: 'Library', icon: 'library' },
    { key: 'settings', name: 'Settings', icon: 'settings' },
  ];

  protected readonly active = computed<Tab>(() => {
    if (this.settings.open()) return 'settings';
    if (this.ui.menuOpen()) return 'library';
    if (this.ui.latestOpen()) return 'latest';
    if (this.ui.searchOpen()) return 'search';
    return 'home';
  });

  protected go(tab: Tab): void {
    const again = this.active() === tab;
    // One screen at a time.
    this.settings.open.set(false);
    this.ui.menuOpen.set(false);
    this.ui.latestOpen.set(false);
    this.ui.languageOpen.set(false);
    if (tab !== 'search') this.ui.searchOpen.set(false);

    if (tab === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (again && tab !== 'search') return; // tapping the open tab again closes it (back to Home)
    if (tab === 'search') { this.ui.searchOpen.set(true); window.scrollTo({ top: 0 }); }
    if (tab === 'latest') this.ui.latestOpen.set(true);
    if (tab === 'library') { this.ui.menuTab.set('library'); this.ui.menuOpen.set(true); }
    if (tab === 'settings') this.settings.openAt();
  }
}

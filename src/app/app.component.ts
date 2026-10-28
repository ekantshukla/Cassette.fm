import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { DOWNLOADS_STATION, LIKED_STATION } from './data/stations';
import { AccountScreenComponent } from './components/account-screen/account-screen.component';
import { AddToPlaylistComponent } from './components/add-to-playlist/add-to-playlist.component';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { LatestPanelComponent } from './components/latest-panel/latest-panel.component';
import { BokehBackgroundComponent } from './components/bokeh-background/bokeh-background.component';
import { HeaderComponent } from './components/header/header.component';
import { IconComponent } from './components/icon/icon.component';
import { LanguagePanelComponent } from './components/language-panel/language-panel.component';
import { MiniPlayerComponent } from './components/mini-player/mini-player.component';
import { PlayerCardComponent } from './components/player-card/player-card.component';
import { PlaylistDrawerComponent } from './components/playlist-drawer/playlist-drawer.component';
import { SettingsPanelComponent } from './components/settings-panel/settings-panel.component';
import { SongListComponent } from './components/song-list/song-list.component';
import { StationChipsComponent } from './components/station-chips/station-chips.component';
import { ToastComponent } from './components/toast/toast.component';
import { TuningPopupComponent } from './components/tuning-popup/tuning-popup.component';
import { AccountService } from './services/account.service';
import { DownloadsService } from './services/downloads.service';
import { LibraryService } from './services/library.service';
import { NativeService } from './services/native.service';
import { PlayerService } from './services/player.service';
import { SettingsService } from './services/settings.service';
import { ToastService } from './services/toast.service';
import { UiService } from './services/ui.service';

/** Page layout. Wires the pieces together; the logic lives in the services. */
@Component({
  selector: 'app-root',
  imports: [
    AccountScreenComponent, AddToPlaylistComponent, BottomNavComponent, LatestPanelComponent, BokehBackgroundComponent, HeaderComponent, IconComponent, LanguagePanelComponent, MiniPlayerComponent, PlayerCardComponent, PlaylistDrawerComponent,
    SettingsPanelComponent, SongListComponent, StationChipsComponent, ToastComponent, TuningPopupComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class AppComponent {
  protected readonly library = inject(LibraryService);
  protected readonly player = inject(PlayerService);
  protected readonly downloads = inject(DownloadsService);
  protected readonly account = inject(AccountService);
  protected readonly native = inject(NativeService);
  private readonly settings = inject(SettingsService);
  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly playerCard = viewChild.required(PlayerCardComponent, { read: ElementRef });

  protected readonly menuOpen = this.ui.menuOpen;
  protected readonly year = new Date().getFullYear();
  private readonly playerCardVisible = signal(true);
  /** Phones only (hidden by CSS on wide screens): show once the big player scrolls away. */
  protected readonly showMini = computed(() => this.player.started() && !this.playerCardVisible());

  constructor() {
    // Load the last-opened playlist so the list isn't empty.
    this.library.load(this.library.selected());

    // Settings → "Download liked songs": save every liked song (quietly, when allowed).
    effect(() => {
      if (!this.settings.autoDownloadLiked() || !this.native.online() || (this.native.isApp && this.settings.wifiOnly() && !this.native.wifi())) return;
      const liked = this.library.liked();
      untracked(() => this.downloads.download(liked, true));
    });

    // Android: the first time music starts, check that the lock-screen controls can be shown.
    let checkedNotifications = false;
    effect(() => {
      if (!this.native.isApp || checkedNotifications || !this.player.isPlaying()) return;
      checkedNotifications = true;
      this.native.notificationsAllowed().then(ok => {
        if (!ok) this.toast.show('Turn on notifications (Settings ⚙) to control music from the lock screen.', 4500);
      });
    });

    // Phone back button: close what's open, otherwise go to the background and keep playing.
    this.native.onBack(() => {
      if (this.account.screenOpen()) {
        if (this.account.required) return false; // sign-up is required: back leaves the app
        this.account.skip();
        return true;
      }
      if (this.ui.addToPlaylist()) { this.ui.addToPlaylist.set(null); return true; }
      if (this.ui.searchOpen()) { this.ui.searchOpen.set(false); return true; }
      if (this.settings.open()) { this.settings.open.set(false); return true; }
      if (this.ui.languageOpen()) { this.ui.languageOpen.set(false); return true; }
      if (this.ui.latestOpen()) { this.ui.latestOpen.set(false); return true; }
      if (this.ui.languageOpen()) { this.ui.languageOpen.set(false); return true; }
      if (this.menuOpen()) { this.menuOpen.set(false); return true; }
      return false;
    });

    afterNextRender(() => {
      const observer = new IntersectionObserver(([entry]) => this.playerCardVisible.set(entry.isIntersecting), { threshold: 0.15 });
      observer.observe(this.playerCard().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected openLibrary(): void {
    this.ui.menuTab.set('library');
    this.menuOpen.set(true);
  }

  /** Opens the songs saved for offline (and plays them, if there are any). */
  protected openDownloads(): void {
    this.player.playStation(DOWNLOADS_STATION);
    if (window.innerWidth <= 900) document.querySelector('app-song-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Opens the visitor's liked songs (and plays them, if there are any). */
  protected openLiked(): void {
    this.player.playStation(LIKED_STATION);
    // On phones the list sits below the player, so bring it into view.
    if (window.innerWidth <= 900) document.querySelector('app-song-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Space bar plays / pauses, unless typing or on a button. */
  protected onKeydown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement).tagName;
    if (event.code === 'Space' && !/INPUT|BUTTON|LI|TEXTAREA/.test(tag)) {
      event.preventDefault();
      this.player.togglePlay();
    }
  }
}

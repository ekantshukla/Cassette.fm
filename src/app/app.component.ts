import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';

import { LIKED_STATION } from './data/stations';
import { BokehBackgroundComponent } from './components/bokeh-background/bokeh-background.component';
import { HeaderComponent } from './components/header/header.component';
import { IconComponent } from './components/icon/icon.component';
import { LanguagePanelComponent } from './components/language-panel/language-panel.component';
import { MiniPlayerComponent } from './components/mini-player/mini-player.component';
import { PlayerCardComponent } from './components/player-card/player-card.component';
import { PlaylistDrawerComponent } from './components/playlist-drawer/playlist-drawer.component';
import { SongListComponent } from './components/song-list/song-list.component';
import { StationChipsComponent } from './components/station-chips/station-chips.component';
import { ToastComponent } from './components/toast/toast.component';
import { TuningPopupComponent } from './components/tuning-popup/tuning-popup.component';
import { LibraryService } from './services/library.service';
import { PlayerService } from './services/player.service';

/** Page layout. Wires the pieces together; the logic lives in the services. */
@Component({
  selector: 'app-root',
  imports: [
    BokehBackgroundComponent, HeaderComponent, IconComponent, LanguagePanelComponent, MiniPlayerComponent, PlayerCardComponent, PlaylistDrawerComponent,
    SongListComponent, StationChipsComponent, ToastComponent, TuningPopupComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class AppComponent {
  protected readonly library = inject(LibraryService);
  protected readonly player = inject(PlayerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly playerCard = viewChild.required(PlayerCardComponent, { read: ElementRef });

  protected readonly menuOpen = signal(false);
  protected readonly year = new Date().getFullYear();
  private readonly playerCardVisible = signal(true);
  /** Phones only (hidden by CSS on wide screens): show once the big player scrolls away. */
  protected readonly showMini = computed(() => this.player.started() && !this.playerCardVisible());

  constructor() {
    // Load the last-opened playlist so the list isn't empty.
    this.library.load(this.library.selected());

    afterNextRender(() => {
      const observer = new IntersectionObserver(([entry]) => this.playerCardVisible.set(entry.isIntersecting), { threshold: 0.15 });
      observer.observe(this.playerCard().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
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

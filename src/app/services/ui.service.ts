import { Injectable, signal } from '@angular/core';

import { Song } from '../models/song.model';

/** Small bits of screen state shared by components that sit in different places on the page. */
@Injectable({ providedIn: 'root' })
export class UiService {
  /** The music-language list (opened from the switch in the header, drawn at page level). */
  readonly languageOpen = signal(false);
  /** Songs waiting for "Add to playlist" (the sheet is open while this is set). */
  readonly addToPlaylist = signal<Song[] | null>(null);
  /** The Library / Browse menu. */
  readonly menuOpen = signal(false);
  /** Which tab the menu shows. */
  readonly menuTab = signal<'library' | 'browse'>('library');
  /** Phones: the search field is open (from Search in the bottom bar). */
  readonly searchOpen = signal(false);
  /** The "Latest & Trending" screen. */
  readonly latestOpen = signal(false);
}

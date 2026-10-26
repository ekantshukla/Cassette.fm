import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';

import { HINDI, STATIONS } from '../../data/stations';
import { ArchiveDoc } from '../../models/archive.model';
import { Station } from '../../models/station.model';
import { ArchiveService } from '../../services/archive.service';
import { LibraryService, SongMatch } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { ToastService } from '../../services/toast.service';
import { VoiceSearchService } from '../../services/voice-search.service';
import { cleanName, firstValue, highlight, normalize } from '../../utils/text.utils';
import { IconComponent } from '../icon/icon.component';

interface AlbumResult { id: string; title: string; artist: string; }

/** Waits this long after typing stops before asking archive.org. */
const SEARCH_DELAY_MS = 400;

/**
 * Search in the header. Desktop: a search field. Phones: a search button that opens the field over the header.
 * Shows songs from playlists already loaded, plus albums from anywhere on the Internet Archive.
 */
@Component({
  selector: 'app-search-box',
  imports: [IconComponent, NgTemplateOutlet],
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class SearchBoxComponent {
  private readonly archive = inject(ArchiveService);
  private readonly library = inject(LibraryService);
  private readonly player = inject(PlayerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly voice = inject(VoiceSearchService);
  private readonly toast = inject(ToastService);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');

  protected readonly text = signal('');
  /** The search field is showing (the header shows only a search button until tapped). */
  protected readonly expanded = signal(false);
  /** Phones show a search button; desktop shows the field all the time. */
  protected readonly isPhone = signal(false);
  /** The results list is showing. */
  protected readonly isOpen = signal(false);
  protected readonly albums = signal<AlbumResult[] | null>(null);
  protected readonly albumsLoading = signal(false);
  private remoteQuery = '';
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly query = computed(() => normalize(this.text()));

  constructor() {
    const phone = matchMedia('(max-width: 600px)');
    this.isPhone.set(phone.matches);
    phone.addEventListener('change', e => { this.isPhone.set(e.matches); this.expanded.set(false); });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }
  protected readonly highlight = highlight;

  /** Songs from loaded playlists: exact matches first, then partial ones. */
  protected readonly songHits = computed<SongMatch[]>(() => {
    const q = this.query();
    const all = this.library.searchable();
    if (!q) return all.slice(0, 12);
    const words = q.split(' ').filter(Boolean);
    const strong = all.filter(m => m.haystack.includes(q) || words.every(w => m.haystack.includes(w)));
    const weak = all.filter(m => !strong.includes(m) && words.some(w => w.length >= 3 && m.haystack.includes(w)));
    return [...strong, ...weak].slice(0, 30);
  });

  protected thumb(itemId: string): string {
    return `url('${this.archive.thumbnailUrl(itemId)}')`;
  }

  /** Search button tapped: show the field over the header and put the cursor in it. */
  protected expand(): void {
    this.expanded.set(true);
    setTimeout(() => this.input()?.nativeElement.focus());
  }

  /** Mic tapped: listen, and put what was said into the search. */
  protected async speak(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.library.load(STATIONS[0]);
    this.isOpen.set(true);
    try {
      await this.voice.listen(text => {
        const el = this.input()?.nativeElement;
        if (el) el.value = text;
        this.onInput(text);
      });
    } catch (err) {
      this.toast.show((err as Error).message, 3000);
    }
  }

  protected onFocus(): void {
    this.library.load(STATIONS[0]); // so "Popular classics" has something to show
    this.isOpen.set(true);
  }

  protected onInput(value: string): void {
    this.text.set(value);
    this.isOpen.set(true);
    this.searchArchive(normalize(value));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.close(true);
    if (event.key === 'Enter') {
      const first = this.host.nativeElement.querySelector<HTMLButtonElement>('.result');
      first?.click();
    }
  }

  protected playSong(match: SongMatch): void {
    this.library.select(match.station);
    this.player.playAt(match.station.key, match.index);
    this.afterPick();
  }

  protected playAlbum(album: AlbumResult): void {
    const station: Station = {
      key: `album:${album.id}`, group: 'Search', name: album.title, subtitle: album.artist,
      mark: '♪', color: '#FF6F91', items: [album.id], isTemporary: true,
    };
    this.player.playStation(station);
    this.afterPick();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.host.nativeElement.contains(event.target as Node)) return;
    this.isOpen.set(false);
    if (!this.text()) this.expanded.set(false); // tapped away from an empty search: fold back to the button
  }

  private afterPick(): void {
    this.close(true);
    document.querySelector('app-player-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected close(clear: boolean): void {
    if (this.voice.listening()) this.voice.stop();
    this.isOpen.set(false);
    this.expanded.set(false);
    if (clear) {
      this.text.set('');
      const el = this.input()?.nativeElement;
      if (el) el.value = '';
      this.albums.set(null);
      this.remoteQuery = '';
    }
    this.input()?.nativeElement.blur();
  }

  /** Asks archive.org for matching albums, once typing pauses. */
  private searchArchive(q: string): void {
    if (q === this.remoteQuery) return;
    clearTimeout(this.timer);
    this.remoteQuery = q;
    this.albums.set(null);
    if (q.length < 2) { this.albumsLoading.set(false); return; }

    this.albumsLoading.set(true);
    this.timer = setTimeout(async () => {
      const words = q.split(' ').map(w => w.replace(/["():\\]/g, '')).filter(Boolean).join(' AND ');
      // Search within the music language picked in the header (Bollywood for Hindi, Sandalwood for Kannada …).
      const scope = this.library.language().searchWords || HINDI;
      const docs = await this.archive.search(`(${words}) AND ${scope}`, 12);
      if (this.remoteQuery !== q) return; // the visitor kept typing
      this.albums.set((docs ?? []).map(toAlbum));
      this.albumsLoading.set(false);
    }, SEARCH_DELAY_MS);
  }
}

function toAlbum(doc: ArchiveDoc): AlbumResult {
  return {
    id: doc.identifier,
    title: cleanName(firstValue(doc.title)) || doc.identifier,
    artist: firstValue(doc.creator) || 'Internet Archive',
  };
}

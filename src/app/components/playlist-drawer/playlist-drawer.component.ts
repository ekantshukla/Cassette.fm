import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';

import { APK_URL } from '../../data/app-info';
import { DOWNLOADS_STATION, LIKED_STATION } from '../../data/stations';
import { Station } from '../../models/station.model';
import { CollectionsService, PLAYLIST_COLORS, PLAYLIST_EMOJIS, USER_PREFIX } from '../../services/collections.service';
import { DownloadsService } from '../../services/downloads.service';
import { LibraryService } from '../../services/library.service';
import { NativeService } from '../../services/native.service';
import { PlayerService } from '../../services/player.service';
import { StorageService } from '../../services/storage.service';
import { ToastService } from '../../services/toast.service';
import { SongBotService } from '../../services/song-bot.service';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../icon/icon.component';

type Filter = 'all' | 'playlists' | 'smart' | 'offline' | 'pinned';
type Sort = 'recent' | 'added' | 'az' | 'size';

const SORTS: Array<{ key: Sort; name: string }> = [
  { key: 'recent', name: 'Recents' },
  { key: 'added', name: 'Recently added' },
  { key: 'az', name: 'A – Z' },
  { key: 'size', name: 'Most songs' },
];
const KEY_VIEW = 'cfm.libview';

interface LibraryItem { station: Station; subtitle: string; count: number; added: number; pinned: boolean; }

/**
 * The ☰ menu: "Your Library" (like Spotify's, plus smart playlists, unlimited pins,
 * recently deleted, import/export) and "Browse" (every ready-made playlist).
 */
@Component({
  selector: 'app-playlist-drawer',
  imports: [IconComponent],
  templateUrl: './playlist-drawer.component.html',
  styleUrl: './playlist-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close.emit()' },
})
export class PlaylistDrawerComponent {
  protected readonly library = inject(LibraryService);
  protected readonly collections = inject(CollectionsService);
  protected readonly downloads = inject(DownloadsService);
  protected readonly native = inject(NativeService);
  protected readonly ui = inject(UiService);
  protected readonly bot = inject(SongBotService);
  private readonly player = inject(PlayerService);
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly apkUrl = APK_URL;
  protected readonly sorts = SORTS;
  protected readonly filters: Array<{ key: Filter; name: string }> = [
    { key: 'all', name: 'All' }, { key: 'playlists', name: 'Playlists' }, { key: 'smart', name: 'Smart' },
    { key: 'offline', name: 'Downloaded' }, { key: 'pinned', name: 'Pinned' },
  ];

  readonly open = input(false);
  readonly close = output<void>();

  private readonly saved = this.storage.get<{ sort?: Sort; grid?: boolean }>(KEY_VIEW, {});
  protected readonly filter = signal<Filter>('all');
  protected readonly sort = signal<Sort>(this.saved.sort ?? 'recent');
  protected readonly grid = signal(!!this.saved.grid);
  protected readonly query = signal('');
  protected readonly searching = signal(false);
  protected readonly creating = signal(false);
  /** Item whose ⋯ actions are open. */
  protected readonly menuFor = signal<string | null>(null);
  protected readonly renaming = signal<string | null>(null);
  protected readonly showDeleted = signal(false);
  protected readonly sortName = computed(() => SORTS.find(s => s.key === this.sort())!.name);

  /** Everything in Your Library, filtered, searched and sorted, pinned first. */
  protected readonly items = computed<LibraryItem[]>(() => {
    const c = this.collections;
    const pins = c.pins();
    const opened = c.opened();
    const liked = this.library.liked().length;
    const playlists = c.playlists();
    const all: LibraryItem[] = [
      { station: LIKED_STATION, subtitle: `Playlist · ${liked} songs`, count: liked, added: 1 },
      { station: DOWNLOADS_STATION, subtitle: `${this.downloads.count()} songs · plays offline`, count: this.downloads.count(), added: 0 },
      ...c.userStations().map(s => {
        const p = playlists.find(x => USER_PREFIX + x.id === s.key)!;
        const downloaded = p.songs.length > 0 && p.songs.every(song => this.downloads.isDownloaded(song));
        return { station: s, subtitle: `Your playlist · ${p.songs.length} songs${downloaded ? ' · ⤓' : ''}`, count: p.songs.length, added: p.createdAt };
      }),
      ...c.smartStations.map(s => {
        const n = this.library.songsFor(s.key).length;
        return { station: s, subtitle: `Smart · ${n ? n + ' songs' : 'fills as you listen'}`, count: n, added: 2 };
      }),
      // Ready-made playlists the listener pinned from Browse.
      ...this.library.stations().filter(s => pins.includes(s.key)).map(s => ({ station: s, subtitle: `Playlist · ${s.subtitle}`, count: this.library.songsFor(s.key).length, added: 0 })),
    ].map(i => ({ ...i, pinned: pins.includes(i.station.key) }));

    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    const kept = all.filter(i => {
      const s = i.station;
      if (q && !`${s.name} ${s.subtitle}`.toLowerCase().includes(q)) return false;
      if (f === 'playlists') return !!(s.isUser || s.isLiked);
      if (f === 'smart') return !!s.isSmart;
      if (f === 'offline') return !!s.isDownloads || (!!s.isUser && i.subtitle.endsWith('⤓'));
      if (f === 'pinned') return i.pinned;
      return true;
    });

    const by: Record<Sort, (a: LibraryItem, b: LibraryItem) => number> = {
      recent: (a, b) => (opened[b.station.key] ?? b.added) - (opened[a.station.key] ?? a.added),
      added: (a, b) => b.added - a.added,
      az: (a, b) => a.station.name.localeCompare(b.station.name),
      size: (a, b) => b.count - a.count,
    };
    return kept.sort((a, b) => Number(b.pinned) - Number(a.pinned) || by[this.sort()](a, b));
  });

  constructor() {
    // Move keyboard focus to the open playlist when the menu opens.
    effect(() => {
      if (!this.open()) { this.menuFor.set(null); return; }
      setTimeout(() => {
        const el = this.host.nativeElement;
        (el.querySelector<HTMLElement>('.item[aria-current="true"]') ?? el.querySelector<HTMLElement>('.tab[aria-selected="true"]'))?.focus();
      }, 50);
    });
  }

  protected pick(station: Station): void {
    this.close.emit();
    this.player.playStation(station);
    document.querySelector('app-song-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected nextSort(): void {
    const i = SORTS.findIndex(s => s.key === this.sort());
    this.sort.set(SORTS[(i + 1) % SORTS.length].key);
    this.saveView();
  }

  protected toggleGrid(): void {
    this.grid.update(g => !g);
    this.saveView();
  }

  protected toggleSearch(): void {
    this.searching.update(s => !s);
    if (!this.searching()) this.query.set('');
    else setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.lib-search')?.focus(), 30);
  }

  protected startCreate(): void {
    this.creating.set(true);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.create input')?.focus(), 30);
  }

  protected create(name: string): void {
    const playlist = this.collections.create(name);
    this.creating.set(false);
    this.toast.show(`Created “${playlist.name}”. Tap ⋯ on any song to add it.`, 3000);
    this.pick(this.library.findStation(USER_PREFIX + playlist.id)!);
  }

  protected toggleMenu(event: Event, key: string): void {
    event.stopPropagation();
    this.menuFor.set(this.menuFor() === key ? null : key);
  }

  protected togglePin(station: Station): void {
    const pinned = this.collections.togglePin(station.key);
    this.toast.show(pinned ? `Pinned ${station.isLiked ? 'Liked songs' : station.name}` : 'Unpinned');
    this.menuFor.set(null);
  }

  protected rename(station: Station, name: string): void {
    this.collections.update(station.key.slice(USER_PREFIX.length), { name });
    this.renaming.set(null);
    this.menuFor.set(null);
  }

  /** Next emoji + colour for a playlist tile. */
  protected restyle(station: Station): void {
    const id = station.key.slice(USER_PREFIX.length);
    const p = this.collections.playlist(id);
    if (!p) return;
    const e = PLAYLIST_EMOJIS[(PLAYLIST_EMOJIS.indexOf(p.emoji) + 1) % PLAYLIST_EMOJIS.length];
    const c = PLAYLIST_COLORS[(PLAYLIST_COLORS.indexOf(p.color) + 1) % PLAYLIST_COLORS.length];
    this.collections.update(id, { emoji: e, color: c });
  }

  protected remove(station: Station): void {
    const id = station.key.slice(USER_PREFIX.length);
    this.collections.remove(id);
    this.menuFor.set(null);
    if (this.library.selected().key === station.key) this.library.select(LIKED_STATION);
    this.toast.show(`Deleted “${station.name}”. Restore it from Recently deleted.`, 3200);
  }

  protected exportOne(station: Station): void {
    this.download(this.collections.exportFile([station.key.slice(USER_PREFIX.length)]), station.name);
    this.menuFor.set(null);
  }

  protected exportAll(): void {
    if (!this.collections.playlists().length) { this.toast.show('Make a playlist first'); return; }
    this.download(this.collections.exportFile(), 'Cassette.fm playlists');
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const n = this.collections.importFile(await file.text());
      this.toast.show(n ? `Imported ${n} ${n === 1 ? 'playlist' : 'playlists'}` : 'No songs in that file');
    } catch {
      this.toast.show("That isn't a Cassette.fm playlist file");
    }
  }

  protected isUser(station: Station): boolean {
    return !!station.isUser;
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected daysLeft(deletedAt: number): number {
    return Math.max(1, 30 - Math.floor((Date.now() - deletedAt) / 864e5));
  }

  private async download(text: string, name: string): Promise<void> {
    const file = `${name.replace(/[^\w\s.-]+/g, '').trim() || 'playlist'}.cassette.json`;
    if (this.native.isApp) {
      // Android: save to the phone's Documents folder (browser-style downloads don't work inside the app).
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      try {
        await Filesystem.writeFile({ path: `Cassette.fm/${file}`, data: text, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
        this.toast.show(`Saved to Documents/Cassette.fm/${file}`, 3500);
      } catch {
        this.toast.show("Couldn't save the file on this phone");
      }
      return;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    this.toast.show('Saved the playlist file');
  }

  private saveView(): void {
    this.storage.set(KEY_VIEW, { sort: this.sort(), grid: this.grid() });
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CollectionsService, UserPlaylist } from '../../services/collections.service';
import { LibraryService } from '../../services/library.service';
import { ToastService } from '../../services/toast.service';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../icon/icon.component';

/** "Add to playlist" sheet: pick one of your playlists, or make a new one with the song(s) in it. */
@Component({
  selector: 'app-add-to-playlist',
  imports: [IconComponent],
  templateUrl: './add-to-playlist.component.html',
  styleUrl: './add-to-playlist.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
})
export class AddToPlaylistComponent {
  protected readonly ui = inject(UiService);
  protected readonly collections = inject(CollectionsService);
  protected readonly library = inject(LibraryService);
  private readonly toast = inject(ToastService);

  protected readonly songs = this.ui.addToPlaylist;
  protected readonly creating = signal(false);
  protected readonly filter = signal('');
  protected readonly title = computed(() => {
    const s = this.songs();
    return !s ? '' : s.length === 1 ? s[0].title : `${s.length} songs`;
  });
  protected readonly playlists = computed(() => {
    const q = this.filter().trim().toLowerCase();
    return this.collections.playlists().filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
  });

  protected has(p: UserPlaylist): boolean {
    const s = this.songs();
    return !!s && s.length === 1 && this.collections.contains(p.id, s[0]);
  }

  protected add(p: UserPlaylist): void {
    const songs = this.songs();
    if (!songs) return;
    if (this.has(p)) {
      this.collections.removeSong(p.id, songs[0]);
      this.toast.show(`Removed from ${p.name}`);
      return;
    }
    const n = this.collections.addSongs(p.id, songs);
    this.toast.show(n ? `Added to ${p.name}` : `Already in ${p.name}`);
    this.close();
  }

  protected create(name: string): void {
    const songs = this.songs() ?? [];
    const p = this.collections.create(name, songs);
    this.toast.show(`Made “${p.name}” with ${songs.length === 1 ? 'this song' : songs.length + ' songs'}`);
    this.close();
  }

  protected likeAll(): void {
    const songs = this.songs() ?? [];
    let n = 0;
    for (const s of songs) if (!this.library.isLiked(s)) { this.library.toggleLike(s); n++; }
    this.toast.show(n ? 'Saved to Liked ♥' : 'Already in Liked');
    this.close();
  }

  close(): void {
    this.songs.set(null);
    this.creating.set(false);
    this.filter.set('');
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

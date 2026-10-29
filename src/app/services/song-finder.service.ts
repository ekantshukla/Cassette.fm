import { Injectable, inject } from '@angular/core';

import { SongRequest } from '../data/classical-drive';
import { HINDI } from '../data/stations';
import { ArchiveDoc } from '../models/archive.model';
import { Song } from '../models/song.model';
import { firstValue, normalize } from '../utils/text.utils';
import { ArchiveService } from './archive.service';

/** How many albums to open per lookup before giving up. */
const ALBUMS_TO_TRY = 3;
/** Versions we never want in the playlist, even if the name matches. */
const UNWANTED = /bhojpuri|karaoke|instrumental|\bcover\b|unplugged|ringtone|\bsped\b|slowed|reverb/i;
/** Words that don't identify a song ("ft", "from", "version" …), ignored when comparing names. */
const FILLER = new Set(['ft', 'feat', 'from', 'film', 'movie', 'song', 'songs', 'version', 'original', 'male', 'female', 'the', 'hd', 'audio', 'video', 'remastered', 'jhankar']);

/**
 * Finds a specific song ("Dil Ka Aalam" from "Aashiqui") on the Internet Archive.
 *
 * 1. Film first: opens albums whose TITLE contains the film name and picks the
 *    track with the closest name.
 * 2. No film, or no match: searches Hindi uploads by the song's name, and only
 *    accepts a track whose name matches closely AND, when the file lists singers,
 *    shares at least one singer with the request.
 * Bhojpuri, karaoke and instrumental uploads are always skipped.
 * Searches and albums are remembered, so songs from the same film share requests.
 */
@Injectable({ providedIn: 'root' })
export class SongFinderService {
  private readonly archive = inject(ArchiveService);
  private readonly searches = new Map<string, Promise<ArchiveDoc[]>>();
  private readonly albums = new Map<string, Promise<Song[]>>();

  async find(request: SongRequest): Promise<Song | null> {
    if (request.film) {
      const film = normalize(request.film);
      const docs = await this.search(`title:("${request.film}") AND (${HINDI} OR soundtrack OR ost OR movie OR film)`);
      // Only albums that are really this film ("Aashiqui", "Aashiqui OST"), not something that just mentions it.
      const ids = docs.filter(d => normalize(firstValue(d.title)).includes(film)).map(d => d.identifier);
      const found = await this.pick(ids, request, 'film');
      if (found) return found;
    }

    // Search with the song's own words (not the smoothed spellings used for comparing).
    const words = request.title.replace(/\([^)]*\)/g, ' ').split(/\s+/)
      .map(w => w.replace(/["():\\]/g, ''))
      .filter(w => w.length > 1 && !FILLER.has(w.toLowerCase()));
    if (!words.length) return null;
    const docs = await this.search(`title:(${words.join(' AND ')}) AND (${HINDI} OR punjabi OR ghazal)`);
    return this.pick(docs.map(d => d.identifier), request, 'name');
  }

  /**
   * Cassette AI's "Play here": tries harder than find(), in any language, and stops at the first hit.
   *  1. the normal lookup (film album, then Hindi uploads by name) for Hindi songs
   *  2. albums titled after the film, in the song's own language
   *  3. jukebox / "all songs" / full-album uploads of the film
   *  4. the song's name with common spelling variants (Deewana / Diwana / Divana), any upload
   *  5. the song's name together with a singer's name
   * Every candidate must still pass the strict name match (and singer check), and clips, previews,
   * ringtones and karaoke are skipped, so a hit is the full song.
   */
  async findAnywhere(request: SongRequest & { language?: string }): Promise<Song | null> {
    const language = normalize(request.language || 'hindi');
    const skip = unwantedFor(language);
    const hindi = !language || language === 'hindi';
    if (hindi) {
      const found = await this.find(request).catch(() => null);
      if (found) return found;
    }

    const langWords = hindi ? 'hindi OR bollywood' : `${language}`;
    const tries: Array<[string, 'film' | 'name']> = [];
    if (request.film) {
      const film = request.film.replace(/["\\]/g, '');
      tries.push([`title:("${film}") AND (${langWords} OR soundtrack OR ost OR movie OR film OR songs)`, 'film']);
      tries.push([`"${film}" AND (jukebox OR "full album" OR "all songs" OR "audio songs" OR "video songs")`, 'film']);
    }
    const name = nameQuery(request.title);
    if (name) {
      tries.push([`title:(${name})`, 'name']);
      const singer = [...singerWords(request.artist)][0];
      if (singer) tries.push([`(${name}) AND creator:(${singer}*)`, 'name']);
    }

    for (const [query, via] of tries) {
      const docs = await this.search(query, skip).catch(() => []);
      const ids = via === 'film' && request.film
        ? docs.filter(d => normalize(`${firstValue(d.title)}`).includes(normalize(request.film!).split(' ')[0])).map(d => d.identifier)
        : docs.map(d => d.identifier);
      const found = await this.pick(ids, request, via, skip);
      if (found) return found;
    }
    return null;
  }

  /** Opens the top albums and returns the best-matching song, or null if none is close enough. */
  private async pick(ids: string[], request: SongRequest, via: 'film' | 'name', skip = UNWANTED): Promise<Song | null> {
    const albums = await Promise.all(ids.slice(0, ALBUMS_TO_TRY).map(id => this.songsOf(id)));
    for (const songs of albums) {
      const match = bestMatch(songs, request, via, skip);
      // The match is strict, so it's safe to show the clean hand-written name and singers.
      if (match) return { ...match, title: request.title, artist: request.artist || match.artist };
    }
    return null;
  }

  private search(query: string, skip = UNWANTED): Promise<ArchiveDoc[]> {
    const key = `${skip.source}|${query}`;
    if (!this.searches.has(key)) {
      this.searches.set(key, this.archive.search(query, 8).then(docs =>
        (docs ?? []).filter(d => !skip.test(`${firstValue(d.title)} ${firstValue(d.creator)}`))));
    }
    return this.searches.get(key)!;
  }

  private songsOf(itemId: string): Promise<Song[]> {
    if (!this.albums.has(itemId)) this.albums.set(itemId, this.archive.getSongs(itemId));
    return this.albums.get(itemId)!;
  }
}

/** The song whose name best matches the request, or null if none is close enough. */
function bestMatch(songs: Song[], request: SongRequest, via: 'film' | 'name', skip = UNWANTED): Song | null {
  const target = keyWords(request.title);
  const singers = singerWords(request.artist);
  let best: Song | null = null;
  let bestScore = 0;

  for (const song of songs) {
    if (skip.test(`${song.title} ${song.album} ${song.artist}`)) continue;
    const candidate = keyWords(song.title);
    const score = similarity(target, candidate, via);
    if (score <= bestScore) continue;

    // Searching by name across many uploads: if the file names its singers, one must match.
    // (When a file has no singer tag, its artist field holds the album name; skip the check then.)
    if (via === 'name' && singers.size && song.artist && song.artist !== song.album) {
      const fileSingers = singerWords(song.artist);
      if (fileSingers.size && ![...singers].some(s => fileSingers.has(s))) continue;
    }
    best = song;
    bestScore = score;
  }
  return best;
}

/**
 * How well a track name matches the requested name: 0 = no match, higher = better.
 * Both directions must agree, so "Pardesi Pardesi" no longer matches "Ae Pardesi Bhaiya Ho".
 *  - in the film's own album we allow a few extra words ("Pardesi Pardesi Jana Nahi")
 *  - in a name search the names must be nearly identical
 */
function similarity(target: string[], candidate: string[], via: 'film' | 'name'): number {
  const t = new Set(target);
  const c = new Set(candidate);
  if (!t.size || !c.size) return 0;
  const shared = [...t].filter(w => c.has(w)).length;
  const coverage = shared / t.size;   // how much of the requested name is in the track name
  const precision = shared / c.size;  // how much of the track name is the requested name

  // A shortened track name ("Tujhe Dekha To" for "Tujhe Dekha To Ye Jaana Sanam") is fine if it's all ours.
  const shortForm = c.size >= 3 && precision === 1 && coverage >= 0.5;

  const ok = via === 'film'
    ? shortForm || (coverage >= 0.8 && c.size - shared <= 3)
    : shortForm || (coverage >= 0.85 && precision >= 0.75);
  return ok ? coverage + precision : 0;
}

/**
 * Splits a Hindi song name into comparable words, smoothing common spelling
 * differences: "Pyaara" = "Pyara", "Chaahe" = "Chahe", "Deewana" = "Diwana".
 */
function keyWords(text: string): string[] {
  return normalize(text.replace(/\([^)]*\)/g, ' '))
    .split(' ')
    .filter(w => w && !FILLER.has(w))
    .map(w => w
      .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/w/g, 'v').replace(/z/g, 'j')
      .replace(/([a-z])\1+/g, '$1')        // aa -> a, nn -> n
      .replace(/([kgcjtdpb])h/g, '$1')     // th -> t, kh -> k
      .replace(/y$/, 'i'));
}

/** Singer surnames and names: "Kumar Sanu & Alka Yagnik" -> {sanu, alka, yagnik} */
function singerWords(artists?: string): Set<string> {
  const common = new Set(['kumar', 'singh', 'and', 'mohd', 'mohammed', 'md', 'with', 'others', 'various', 'chorus']);
  return new Set(keyWords(artists ?? '').filter(w => w.length > 2 && !common.has(w)));
}

/** Versions to skip; a Bhojpuri request may of course be Bhojpuri. */
function unwantedFor(language: string): RegExp {
  return language === 'bhojpuri' ? new RegExp(UNWANTED.source.replace('bhojpuri|', ''), 'i') : UNWANTED;
}

/**
 * The song's name as an Archive search that also accepts the usual spellings of each word:
 * "Dil Deewana" -> (dil) AND (deewana OR diwana OR deevana OR divana)
 */
function nameQuery(title: string): string {
  const words = normalize(title.replace(/\([^)]*\)/g, ' ')).split(' ').filter(w => w.length > 1 && !FILLER.has(w)).slice(0, 6);
  if (!words.length) return '';
  return words.map(w => {
    const forms = new Set([w]);
    const swap = (from: RegExp, to: string) => [...forms].forEach(f => { if (forms.size < 5) forms.add(f.replace(from, to)); });
    swap(/ee/g, 'i'); swap(/i/g, 'ee'); swap(/oo/g, 'u'); swap(/w/g, 'v'); swap(/v/g, 'w');
    swap(/aa/g, 'a'); swap(/z/g, 'j'); swap(/ph/g, 'f');
    if (/a$/.test(w) && w.length > 3) forms.add(w + 'a');
    return `(${[...forms].slice(0, 5).join(' OR ')})`;
  }).join(' AND ');
}

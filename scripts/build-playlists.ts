/*
 * Builds public/playlists.json: every playlist in the menu, already looked up on archive.org.
 * The site loads this one file, so playlists open instantly instead of waiting for
 * dozens of archive.org requests in each visitor's browser.
 *
 *   npm run playlists
 *
 * GitHub Actions runs this before every deploy and once a day (see .github/workflows/deploy.yml).
 * It reuses the site's own services, so the result is exactly what the site would build live.
 *
 * PREVIOUS_URL (optional): the live site's playlists.json. If archive.org has a bad moment and a
 * playlist comes back much smaller than before, the previous version is kept instead.
 */
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { ALL_STATIONS as STATIONS, LANGUAGES } from '../src/app/data/languages';
import { Verdicts, aiEnabled, filterSongs } from './ai-filter';
import { Song } from '../src/app/models/song.model';
import { ArchiveService } from '../src/app/services/archive.service';
import { CollectionsService } from '../src/app/services/collections.service';
import { LibraryService, PLAYLISTS_VERSION, PrebuiltPlaylists } from '../src/app/services/library.service';
import { SongFinderService } from '../src/app/services/song-finder.service';
import { StorageService } from '../src/app/services/storage.service';

const OUTPUT = 'public/playlists.json';
/** Keep the previous list if the new one has less than this share of its songs. */
const MIN_SHARE_OF_PREVIOUS = 0.5;

async function main(): Promise<void> {
  const injector = Injector.create({ providers: [ArchiveService, SongFinderService, StorageService, CollectionsService, LibraryService] });
  const library = runInInjectionContext(injector, () => injector.get(LibraryService));
  const previousFile = await fetchPrevious();
  const previous = previousFile?.playlists ?? null;
  /** The AI check's remembered answers (so each song is only asked about once). */
  const verdicts: Verdicts = { ...(previousFile?.verdicts ?? {}) };
  console.log(aiEnabled() ? `AI song check: on (${Object.keys(verdicts).length} answers remembered)\n` : 'AI song check: off (no ANTHROPIC_API_KEY secret)\n');
  let aiAsked = 0, aiDropped = 0;

  const playlists: Record<string, Song[]> = {};
  for (const station of STATIONS) {
    const started = Date.now();
    await library.load(station);
    let songs = library.songsFor(station.key);
    const before = previous?.[station.key] ?? [];

    // AI check: keep only genuine original songs of this language's industry.
    const language = LANGUAGES.find(l => station.key.startsWith(l.code + '-')) ?? LANGUAGES[0];
    const checked = await filterSongs(station, language, songs, verdicts);
    songs = checked.songs;
    aiAsked += checked.stats.asked;
    aiDropped += checked.stats.dropped;

    let note = checked.stats.dropped ? ` (AI removed ${checked.stats.dropped})` : '';
    if (before.length && songs.length < before.length * MIN_SHARE_OF_PREVIOUS) {
      note += ` (only ${songs.length}; kept previous ${before.length})`;
      songs = before;
    }
    playlists[station.key] = songs;
    console.log(`${station.name.padEnd(18)} ${String(songs.length).padStart(4)} songs  ${((Date.now() - started) / 1000).toFixed(1)}s${note}`);
  }

  const file: PrebuiltPlaylists = { version: PLAYLISTS_VERSION, generatedAt: new Date().toISOString(), playlists, verdicts };
  if (aiEnabled()) console.log(`\nAI song check: asked about ${aiAsked} new songs; removed ${aiDropped} songs in total.`);
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(file));
  const total = Object.values(playlists).reduce((n, list) => n + list.length, 0);
  console.log(`\nWrote ${OUTPUT}: ${total} songs in ${STATIONS.length} playlists.`);
}

async function fetchPrevious(): Promise<PrebuiltPlaylists | null> {
  const url = process.env['PREVIOUS_URL'];
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const file = (await res.json()) as PrebuiltPlaylists;
    // Only reuse lists made under the same rules (older ones may hold songs we now block).
    if (file.version !== PLAYLISTS_VERSION) return file.verdicts ? { ...file, playlists: {} } : null; // reuse AI answers even across versions
    return file;
  } catch {
    return null;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

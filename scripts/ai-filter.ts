/*
 * AI song check for the ready-made playlists (used by build-playlists.ts, in GitHub Actions).
 *
 * The Internet Archive is full of fan uploads: songs in the wrong language, covers, karaoke,
 * "female versions", re-sung copies, ringtones, mashups and mislabelled files. Keyword searches
 * can't tell those apart. Here Claude reads each song's title, singer and album and keeps only
 * genuine original songs of that playlist's language and film industry.
 *
 *  - Needs the ANTHROPIC_API_KEY secret. Without it, nothing changes (the check is skipped).
 *  - Model: the AI_MODEL variable, default claude-haiku-5-5 (fast and cheap for this kind of sorting).
 *  - Every answer is remembered in playlists.json ("verdicts"), so the next day's run only asks about
 *    songs it hasn't seen before. The first run checks everything; later runs are small.
 *  - Safe by design: if the API fails, or would remove almost everything, the playlist is kept as it was.
 */
import type { Language } from '../src/app/data/languages';
import type { Song } from '../src/app/models/song.model';
import type { Station } from '../src/app/models/station.model';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env['AI_MODEL'] || 'claude-haiku-5-5';
/** Songs per request. */
const BATCH = 60;
/** Requests at once. */
const PARALLEL = 4;
/** If the AI would keep less than this share of a playlist, something is off: keep the playlist as it was. */
const MIN_KEEP_SHARE = 0.15;

/** Remembered answers: "<language>:<dj 0|1>:<itemId>/<file>" → 1 keep, 0 drop. */
export type Verdicts = Record<string, 0 | 1>;

export interface FilterStats { asked: number; dropped: number; skipped: boolean; }

export function aiEnabled(): boolean {
  return !!process.env['ANTHROPIC_API_KEY'];
}

/**
 * Returns the songs of `station` that are genuine originals of `language`'s industry.
 * `verdicts` is read and updated in place.
 */
export async function filterSongs(station: Station, language: Language, songs: Song[], verdicts: Verdicts): Promise<{ songs: Song[]; stats: FilterStats }> {
  const stats: FilterStats = { asked: 0, dropped: 0, skipped: false };
  if (!aiEnabled() || !songs.length) return { songs, stats: { ...stats, skipped: true } };

  const dj = station.bassBoost ? 1 : 0;
  const keyOf = (s: Song) => `${language.code}:${dj}:${s.itemId}/${s.file}`;
  const unknown = songs.filter(s => verdicts[keyOf(s)] === undefined);

  const batches: Song[][] = [];
  for (let i = 0; i < unknown.length; i += BATCH) batches.push(unknown.slice(i, i + BATCH));

  let failed = false;
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const answers = await Promise.all(batches.slice(i, i + PARALLEL).map(batch => ask(batch, station, language, !!dj)));
    answers.forEach((keep, j) => {
      const batch = batches[i + j];
      if (!keep) { failed = true; return; } // this batch failed: don't remember anything for it
      stats.asked += batch.length;
      batch.forEach((song, k) => { verdicts[keyOf(song)] = keep.has(k) ? 1 : 0; });
    });
  }

  // Songs the AI couldn't answer for (failed batch) stay in, so a bad API day never empties playlists.
  const kept = songs.filter(s => verdicts[keyOf(s)] !== 0);
  stats.dropped = songs.length - kept.length;
  if (kept.length < songs.length * MIN_KEEP_SHARE) {
    console.log(`  AI would keep only ${kept.length}/${songs.length} in ${station.name}: keeping the playlist unfiltered`);
    return { songs, stats: { ...stats, skipped: true } };
  }
  if (failed) console.log(`  (some AI requests failed for ${station.name}; those songs were kept unchecked)`);
  return { songs: kept, stats };
}

/** One request: which of these songs belong? Returns the kept positions, or null if the request failed. */
async function ask(batch: Song[], station: Station, language: Language, dj: boolean): Promise<Set<number> | null> {
  const lines = batch.map((s, i) => `${i}. "${clip(s.title)}" | singer: ${clip(s.artist)} | album: ${clip(s.album)}`).join('\n');
  const rules = [
    `Language and industry: ${language.name} songs from ${language.industry}${language.code === 'en' ? ' (Hollywood movie songs and soundtracks)' : ''}.`,
    `Playlist: "${station.name}" (${station.subtitle}).`,
    'KEEP a song only if it is very likely a real, original released song of that language and industry, sung by the original artists.',
    'DROP: songs in another language or from another industry (e.g. a Bhojpuri, Tamil or Pakistani song in a Bollywood playlist; dubbed versions),',
    'covers, karaoke, instrumental or ringtone versions, "female/male/sad version" re-recordings by other singers, unplugged/reprise covers by unknown people,',
    'mashups, medleys, jukeboxes and nonstop mixes, speeches, devotional/religious recordings, comedy, and files whose name is junk (e.g. "Track 02", "audio", numbers only).',
    dj ? 'This is a DJ playlist: DJ remixes and bass-boosted versions of real songs of this industry are WANTED here.' : 'Remixes and DJ versions should be dropped unless they are the official film version.',
    'When unsure whether a well-known title is real, keep it. When the title is meaningless or clearly wrong, drop it.',
  ].join('\n');

  const body = {
    model: MODEL,
    max_tokens: 400,
    system: 'You sort music metadata for an Indian music app. Answer with JSON only.',
    messages: [{
      role: 'user',
      content: `${rules}\n\nSongs:\n${lines}\n\nReply with only this JSON: {"keep":[numbers of the songs to keep]}`,
    }],
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': process.env['ANTHROPIC_API_KEY']!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise(r => setTimeout(r, 2000 * attempt * attempt));
        continue;
      }
      if (!res.ok) {
        console.log(`  AI request refused (${res.status}): ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = (data.content ?? []).map(c => c.text ?? '').join('');
      const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const keep = (JSON.parse(json) as { keep?: unknown }).keep;
      if (!Array.isArray(keep)) return null;
      return new Set(keep.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < batch.length));
    } catch {
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

function clip(text: string): string {
  return String(text ?? '').replace(/["\n]/g, ' ').slice(0, 90);
}

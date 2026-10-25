import { Station } from '../models/station.model';
import { CLASSICAL_DRIVE } from './classical-drive';

/*
 * ==========================================================================
 *  PLAYLISTS — everything in the menu is defined here.
 *
 *  Each playlist is a live search on the Internet Archive (archive.org):
 *  free, ad-free, no API key. Results are sorted by downloads, so the
 *  most-loved uploads play first.
 *
 *  query        archive.org search words (AND / OR and "quoted phrases")
 *  backupQuery  looser search, used only if `query` finds too few songs
 *  items        archive.org item IDs that always play first
 *               (the part after archive.org/details/ in a link)
 *  songList     a hand-picked list of songs, played in order
 *               (see classical-drive.ts, used by Nostalgic Long Drive)
 *
 *  Tip: try a search on https://archive.org/search (choose "Audio") first.
 * ==========================================================================
 */

/** Words that mark an upload as Hindi film music. */
export const HINDI = '(bollywood OR "hindi film" OR "hindi songs" OR "hindi movie" OR filmi OR hindi)';

export const STATIONS: Station[] = [
  // ---- Start here
  {
    key: 'top', group: 'Start here', name: 'Top Classics', subtitle: 'Most downloaded evergreens',
    mark: '★', color: '#FFB36B', badge: 'Most played',
    query: `${HINDI} AND (evergreen OR classics OR superhits OR "golden hits" OR "old songs")`,
    backupQuery: HINDI,
  },

  // ---- Eras
  {
    key: '80s', group: 'Eras', name: '80s Gold', subtitle: 'Kishore, Lata, Bappi da', mark: '80', color: '#9B59FF',
    query: `${HINDI} AND (80s OR "80's" OR 1980s OR 1980 OR 1985 OR 1989)`,
    backupQuery: `"kishore kumar" OR "bappi lahiri" OR "r d burman" OR "laxmikant pyarelal"`,
  },
  {
    key: '90s', group: 'Eras', name: '90s Bollywood', subtitle: 'Kumar Sanu, Udit, Alka', mark: '90', color: '#FF6F91',
    query: `${HINDI} AND (90s OR "90's" OR 1990s OR 1990 OR 1995 OR 1999)`,
    backupQuery: `"kumar sanu" OR "udit narayan" OR "alka yagnik" OR "nadeem shravan"`,
  },
  {
    key: '00s', group: 'Eras', name: '2000s Nostalgia', subtitle: 'Flip-phone romance', mark: '00', color: '#5EC8FF',
    query: `${HINDI} AND (2000s OR "2000's" OR 2000 OR 2004 OR 2008)`,
    backupQuery: `"sonu nigam" OR shaan OR "atif aslam" OR "himesh reshammiya"`,
  },

  // ---- Explore: every Hindi song on the Archive, most played first, loads more on demand
  {
    key: 'all', group: 'Explore', name: 'Everything Hindi', subtitle: 'Every song on the Archive, most played first',
    mark: '∞', color: '#2FC4A0', endless: true, query: HINDI,
  },

  // ---- Moods
  {
    key: 'drive', group: 'Moods', name: 'Nostalgic Long Drive', subtitle: 'Hand-picked highway classics',
    mark: '🚗', color: '#FF7A59', badge: 'Hand-picked',
    songList: CLASSICAL_DRIVE,
  },
  {
    key: 'rom', group: 'Moods', name: 'Romantic', subtitle: 'Pyaar, ishq, mohabbat', mark: '♡', color: '#FF4F8B',
    query: `${HINDI} AND (romantic OR "love songs" OR love)`,
    backupQuery: `romantic AND (hindi OR bollywood)`,
  },
  {
    key: 'sad', group: 'Moods', name: 'Sad Songs', subtitle: 'Dard bhare nagme', mark: '💔', color: '#5B6CFF',
    query: `${HINDI} AND (sad OR dard OR bewafa OR judai)`,
    backupQuery: `(sad OR dard) AND (hindi OR bollywood OR urdu)`,
  },
  {
    key: 'ghazal', group: 'Moods', name: 'Ghazals', subtitle: 'Jagjit, Ghulam Ali, Pankaj', mark: '♪', color: '#7B68EE',
    query: `(ghazal OR ghazals) AND ("jagjit singh" OR "ghulam ali" OR "pankaj udhas" OR "mehdi hassan" OR "chitra singh")`,
    backupQuery: `ghazal OR ghazals`,
  },
  {
    key: 'party', group: 'Moods', name: 'Dance & Party', subtitle: 'Disco deewane', mark: '✦', color: '#FF9F43',
    query: `${HINDI} AND (dance OR disco OR party OR remix)`,
    backupQuery: `"bappi lahiri" OR (disco AND hindi)`,
  },
];

/** The visitor's own hearts. Always last in the menu. */
export const LIKED_STATION: Station = {
  key: 'liked', group: 'Yours', name: '♥ Liked', subtitle: 'Songs you saved', mark: '♥', color: '#FF6F91', isLiked: true,
};

/** How many songs one playlist holds. */
export const MAX_SONGS = 200;
/** If the main search finds fewer songs than this, the backup search runs too. */
export const MIN_SONGS_BEFORE_BACKUP = 30;
/** How long a playlist's song list is remembered in the visitor's browser. */
export const CACHE_DAYS = 3;

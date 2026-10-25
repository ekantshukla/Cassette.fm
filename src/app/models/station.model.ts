import { SongRequest } from '../data/classical-drive';

/** A playlist in the menu. Each one is a live search on the Internet Archive. */
export interface Station {
  /** Short unique ID, saved in the browser to remember the last playlist */
  key: string;
  /** Menu heading it sits under, e.g. "Eras", "Singers" */
  group: string;
  name: string;
  /** One line shown under the name in the menu */
  subtitle: string;
  /** Short text on the coloured tile in the menu, e.g. "90" */
  mark: string;
  /** Tile colour, also used on the record label before a song loads */
  color: string;
  /** Optional pill shown next to the name, e.g. "Most played" */
  badge?: string;

  /** archive.org search words (AND / OR and "quoted phrases" work) */
  query?: string;
  /** Looser search, used only when `query` finds fewer than 30 songs */
  backupQuery?: string;
  /** archive.org item IDs that always play first */
  items?: string[];
  /** A hand-picked list of songs, played in this order (e.g. Nostalgic Long Drive) */
  songList?: SongRequest[];

  /** "Everything" playlists: keep loading more from the whole Archive with "Load more songs" */
  endless?: boolean;

  /** The "Liked" playlist, filled from the visitor's own hearts */
  isLiked?: boolean;
  /** Made on the fly from a search result; never saved */
  isTemporary?: boolean;
}

export interface StationGroup {
  name: string;
  stations: Station[];
}

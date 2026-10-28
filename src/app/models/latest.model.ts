/**
 * "Latest & Trending": new songs and charts, made once a day by scripts/build-latest.ts
 * and saved as latest.json next to the website.
 *
 * Where the songs come from, and how each one may be played:
 *  - YouTube  (official label uploads): full song in the visible YouTube player, screen on only
 *  - Apple Music charts: 30-second preview, plus a link to Apple Music
 *  - Spotify: link to open it in Spotify (or full play for connected Premium listeners)
 */
export interface LatestTrack {
  /** Unique within its list */
  id: string;
  title: string;
  artist: string;
  /** Cover / thumbnail image */
  cover: string;
  /** YouTube video ID: plays in full in the YouTube player */
  youtubeId?: string;
  /** 30-second preview (Apple / iTunes) */
  previewUrl?: string;
  appleUrl?: string;
  spotifyUri?: string;
  spotifyUrl?: string;
  /** e.g. "2026-10-21" */
  released?: string;
}

export interface LatestFile {
  version: 1;
  generatedAt: string;
  /** India's most-played songs on Apple Music today */
  appleTop: LatestTrack[];
  /** India's trending music videos on YouTube today */
  youtubeTrending: LatestTrack[];
  /** New songs this month, per language code (hi, ta, te …), from YouTube */
  youtubeNew: Record<string, LatestTrack[]>;
  /** This year's hits per language from Spotify search */
  spotifyNew: Record<string, LatestTrack[]>;
}

export const LATEST_VERSION = 1;

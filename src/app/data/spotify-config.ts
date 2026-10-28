/**
 * Spotify connection (optional). See SPOTIFY.md for the 10-minute setup.
 *
 * SPOTIFY_CLIENT_ID is filled in by the GitHub workflows from the repository variable
 * SPOTIFY_CLIENT_ID. Empty = the "Connect Spotify" button is hidden. (A client ID is not a
 * secret; the client SECRET never goes in the app, only in GitHub secrets for build-latest.ts.)
 */
export const SPOTIFY_CLIENT_ID = '';

/** Where Spotify sends the listener back after "Connect Spotify" in the Android app. Register it in the Spotify dashboard. */
export const SPOTIFY_APP_REDIRECT = 'cassettefm://spotify-callback';

export const SPOTIFY_SCOPES = [
  'user-read-private', 'user-read-email', 'streaming',
  'user-library-read', 'user-library-modify',
  'playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-public', 'playlist-modify-private',
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'user-read-recently-played', 'user-top-read', 'user-follow-modify',
].join(' ');

/**
 * Where the website and the Android app live.
 * The GitHub workflows fill these in automatically from the repository they run in
 * (see .github/workflows/android.yml), so you normally never edit this file.
 */
export const GITHUB_REPO = 'ekantshukla/Cassette.fm';
export const APP_VERSION = '1.0.0';

/**
 * Accounts (sign up / log in) in the Android app. Turned on by the workflow when the
 * GOOGLE_SERVICES_JSON secret is set (see ACCOUNTS.md). The website never shows accounts.
 */
export const ACCOUNTS_ENABLED = false;
/**
 * Real accounts on the WEBSITE: the Firebase web app settings as JSON, e.g.
 * '{"apiKey":"…","authDomain":"cassette-fm.firebaseapp.com","projectId":"cassette-fm","appId":"…"}'.
 * Filled in by the workflow from the repository variable FIREBASE_WEB_CONFIG (see ACCOUNTS.md).
 * Empty = the website uses demo accounts saved in the browser.
 */
export const FIREBASE_WEB_CONFIG = '';
/**
 * Cassette AI song finder: the address of your Cloudflare Worker (worker/song-bot.js, see SONG-BOT.md),
 * e.g. 'https://cassette-song-bot.yourname.workers.dev'. Filled in by the workflows from the repository
 * variable SONG_BOT_URL. Empty = the chat still searches the Archive and offers free links, without AI.
 */
export const SONG_BOT_URL = '';
/** Sign in with a phone number + OTP. Off: each OTP text costs money on Firebase (see ACCOUNTS.md). */
export const PHONE_SIGN_IN = false;
/** true = the app can't be used without an account (like Spotify). false = "Not now" is allowed. */
export const REQUIRE_SIGN_IN = false;

const [owner, repo] = GITHUB_REPO.split('/');
/** The live website (GitHub Pages). The app reads fresh playlists from here. */
export const WEBSITE_URL = `https://${owner.toLowerCase()}.github.io/${repo}/`;
/** Always the newest Android app. */
export const APK_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/Cassette.fm.apk`;

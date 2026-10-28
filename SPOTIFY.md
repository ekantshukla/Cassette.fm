# Connect Spotify (optional)

What listeners get after **Connect Spotify** (Settings → Music sources, or Latest → Spotify):
search all of Spotify, their Spotify liked songs and own playlists, **+** to save songs to Spotify, and
**full songs**: on a computer right inside the site, on a phone through the Spotify app (Spotify Connect).

## Spotify's rules in 2026 (important)

- New apps run in **Development Mode**: **at most 5 Spotify accounts** can connect, and you add each one by hand.
  The app owner's Spotify account must have **Premium**.
- Going public ("Extended quota") is only for registered companies with 250,000+ monthly users.
- **Full songs need Spotify Premium.** Free Spotify accounts get "Open in Spotify" instead.
- Spotify songs can't be downloaded or played offline in Cassette.fm.

So Spotify here is a bonus for you and up to 4 friends. Everyone else gets Latest & Trending
(YouTube + Apple Music, see LATEST.md) and the Internet Archive classics.

## Setup (10 minutes)

1. <https://developer.spotify.com/dashboard> → **Create app**.
   - APIs used: **Web API** and **Web Playback SDK**.
   - **Redirect URIs** (add all three):
     - `https://<your-github-username>.github.io/Cassette.fm/` (the website, with the last `/`)
     - `cassettefm://spotify-callback` (the Android app)
     - `http://127.0.0.1:4200/` (only for `npm start` on your computer; Spotify no longer accepts `localhost`)
2. App → **Settings → User Management**: add the name + Spotify email of each person (max 5, including you).
3. Copy the **Client ID**. GitHub repo → **Settings → Secrets and variables → Actions → Variables tab →
   New repository variable** → name `SPOTIFY_CLIENT_ID`.
4. Optional, for the daily "Spotify hits" list everyone sees: copy the **Client secret** →
   **Secrets tab** → `SPOTIFY_CLIENT_SECRET`. (Only GitHub uses it; it never goes inside the app.)
5. Run **Deploy to GitHub Pages** and **Build Android app** again.

If someone not on the list connects, the app tells them to ask you to add them.

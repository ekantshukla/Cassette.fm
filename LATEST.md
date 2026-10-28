# Latest & Trending (new songs)

The **Latest** button on the home screen (and *Browse → Latest & Trending* in the menu) shows new songs.
GitHub builds the list once a day (`scripts/build-latest.ts` → `latest.json`), so it opens instantly.

| Tab | Source | How it plays | Setup |
|---|---|---|---|
| **New this month** | YouTube, official label channels, per language | Full song in the YouTube player (video visible) | `YOUTUBE_API_KEY` secret |
| **Trending now** | YouTube India trending music | Full song in the YouTube player | `YOUTUBE_API_KEY` secret |
| **Top 100 India** | Apple Music most-played in India | 30-second preview + "Open in Apple Music" | nothing, works out of the box |
| **Spotify** | Spotify search: this year's hits per language | Full song for connected Premium listeners, otherwise opens Spotify | see [SPOTIFY.md](SPOTIFY.md) |

## YouTube key (10 minutes, free)

1. <https://console.cloud.google.com> → create a project → **APIs & Services → Library → YouTube Data API v3 → Enable**.
2. **Credentials → Create credentials → API key**. Restrict it to *YouTube Data API v3*.
3. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret** → `YOUTUBE_API_KEY`.
4. **Actions → Deploy to GitHub Pages → Run workflow.**

The free quota is 10,000 units a day; one daily build uses about 1,400 (13 languages × 100 + trending). The key
is only used by GitHub, never shipped inside the app.

## Rules that come with each source (please keep them)

- **YouTube:** songs play in YouTube's own player, which must stay visible. No audio-only, no screen-off or
  background play, no downloads. The app follows this: the video sits at the top of the Latest screen and stops
  when the screen closes or the phone is locked. Some labels block playing outside YouTube; those are skipped.
- **Apple Music:** previews are 30 seconds and link back to Apple Music.
- **Spotify:** see SPOTIFY.md (5-user limit in Development Mode, Premium for full songs).
- Offline downloads stay for Internet Archive classics only.

Run it yourself: `npm run latest` (writes `public/latest.json`; set the env vars above to include YouTube/Spotify).

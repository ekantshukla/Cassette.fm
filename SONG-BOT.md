# Cassette AI: the song finder

Can't find a song? Tap the round **Cassette AI** button that floats at the bottom right of every screen
(above the player and the bottom bar on phones), or "Can't find it? Ask Cassette AI" at the end of search
results. On a computer it opens as a small chat window over the page; on a phone it fills the screen above
the bottom bar. Describe the song any way you remember it. You can give the film, the singer, the
actors, a scene, the year, or a few words, typed or said with the mic.

The AI works out which song(s) you mean and offers, for each one:

1. **Play here**: when a copy is on the Internet Archive, where the app's songs come from. It plays in
   the normal player (ad free, and it can be downloaded), and Next moves through the AI's other suggestions.
   The app looks hard for a copy: the film's album in the song's language, jukebox and full-album uploads,
   the song's name in its usual spellings (Deewana / Diwana / Divana), and the name with a singer. Each match
   must be the right song by name (and singer, when known) and full length, never a clip, ringtone or karaoke.
2. **Watch video here**: the official video in YouTube's own player, inside the chat (needs the
   optional YouTube key below). It stops when you close the chat.
3. **Listen free on** YouTube, JioSaavn, Spotify, YouTube Music, Gaana or Apple Music. Each opens that
   app, or its website, straight on the song.

Without the AI set up, the chat still works: it searches the Archive by name and gives the free links.

## Why a small server

The AI key must never be inside the website or the APK, or anyone could copy it and spend your credit.
So the app talks to a tiny **Cloudflare Worker** (free plan: 100,000 requests a day) that holds the key.
The code is `worker/song-bot.js`.

## Setup (10 minutes)

1. Get an Anthropic API key at <https://console.anthropic.com> and add a little credit. This can be the
   same key as the AI song check (AI-FILTER.md).
2. Sign up at <https://dash.cloudflare.com>. Go to **Workers & Pages → Create → Worker**, name it
   `cassette-song-bot`, then **Deploy**.
3. Choose **Edit code**, delete what's there, paste all of `worker/song-bot.js`, then **Deploy**.
4. In the worker's **Settings → Variables and Secrets**:
   - **Secret** `ANTHROPIC_API_KEY`: your key.
   - Optional **secret** `YOUTUBE_API_KEY`: the same key as in LATEST.md. This turns on "Watch video here".
   - Optional **variable** `ALLOWED_ORIGINS`: `https://<your-github-username>.github.io`. This makes only
     your website (and the app) able to use it.
   - Optional **variable** `AI_MODEL`: the default is `claude-haiku-5-5`.
5. Copy the worker's address, for example `https://cassette-song-bot.yourname.workers.dev`.
6. In GitHub, go to your repo → **Settings → Secrets and variables → Actions → Variables** →
   **New repository variable**. Name it `SONG_BOT_URL` and paste the address.
7. Run **Deploy to GitHub Pages** and **Build Android app** again.

## Check it works

- Before step 6, test the worker from any computer's terminal:
  `curl -X POST https://cassette-song-bot.yourname.workers.dev -H "Content-Type: application/json" -d '{"message":"rain song from Mohra"}'`
  You should get back JSON with `"songs": [...]`. `{"error":"ai_unavailable"}` means the key or credit is wrong.
- After step 7, open the website, tap the Cassette AI button and ask for a song. The answer should name the
  song and film. If it says "the AI song finder isn't switched on yet", the `SONG_BOT_URL` variable is missing
  or the site wasn't redeployed.

## Good to know

- **Limit per person:** each visitor can ask 8 questions a minute, so nobody can burn your credit. Set a
  monthly spend limit in the Anthropic console too.
- **What gets sent:** only what the listener typed, plus the last few messages of the chat for context.
  No accounts, likes or other data go to the AI.
- **No lyrics:** the AI is told never to write out song lyrics. It names songs by their titles only.
- **Mistakes:** AI can get songs wrong. The Archive check and the links search by title, so a wrong
  suggestion simply finds nothing to play.

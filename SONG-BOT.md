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

## Setup (about 10 minutes, all in the browser)

GitHub deploys the bot to Cloudflare and connects the website and app to it by itself. You only create
two free accounts and paste four values into GitHub.

1. **Anthropic key.** At <https://console.anthropic.com>: Settings → API keys → Create key. Copy it.
   Add a little credit under Billing, and set a monthly spend limit there too.
2. **Cloudflare account.** Sign up free at <https://dash.cloudflare.com>. Open **Workers & Pages** once,
   so Cloudflare gives your account its `workers.dev` name.
3. **Cloudflare account ID.** On the Workers & Pages page, copy the **Account ID** (right-hand side).
4. **Cloudflare token.** Click your profile picture → **My Profile → API Tokens → Create Token** →
   template **Edit Cloudflare Workers** → Use template → (Account Resources: your account, Zone
   Resources: All zones) → Continue → Create Token. Copy it (it is shown only once).
5. **Paste into GitHub.** Your repo → **Settings → Secrets and variables → Actions → Secrets** →
   **New repository secret**, four times:
   - `ANTHROPIC_API_KEY`: the key from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: the ID from step 3
   - `CLOUDFLARE_API_TOKEN`: the token from step 4
   - optional `YOUTUBE_API_KEY`: the same key as in LATEST.md; turns on "Watch video here"
6. **Run it.** Actions → **Deploy to GitHub Pages** → Run workflow. In the run, the **Cassette AI** step
   prints the bot's address. Then run **Build Android app** so the APK gets it too.

The bot is redeployed with every website deploy, so it always matches the code in `worker/song-bot.js`.
Only your website and the app can use it.

**Prefer to do it by hand?** Create a Worker named `cassette-song-bot` in the Cloudflare dashboard, paste
`worker/song-bot.js` into it, add the secret `ANTHROPIC_API_KEY` (and optionally `YOUTUBE_API_KEY`), then
put the worker's address in a repository **variable** `SONG_BOT_URL`. A `SONG_BOT_URL` variable always
wins over the automatic setup.

## Check it works

- Test the worker from any computer's terminal (use the address the Cassette AI step printed):
  `curl -X POST https://cassette-song-bot.yourname.workers.dev -H "Content-Type: application/json" -d '{"message":"rain song from Mohra"}'`
  You should get back JSON with `"songs": [...]`. `{"error":"ai_unavailable"}` means the key or credit is wrong.
- After the deploy, open the website, tap the Cassette AI button and ask for a song. The answer should name the
  song and film. If it says "the AI song finder isn't switched on yet", open the last **Deploy to GitHub Pages** run
  and read the **Cassette AI** step: it says what is missing.

## Good to know

- **Limit per person:** each visitor can ask 8 questions a minute, so nobody can burn your credit. Set a
  monthly spend limit in the Anthropic console too.
- **What gets sent:** only what the listener typed, plus the last few messages of the chat for context.
  No accounts, likes or other data go to the AI.
- **No lyrics:** the AI is told never to write out song lyrics. It names songs by their titles only.
- **Mistakes:** AI can get songs wrong. The Archive check and the links search by title, so a wrong
  suggestion simply finds nothing to play.

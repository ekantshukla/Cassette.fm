# AI song check (optional)

The Internet Archive is full of fan uploads. Keyword searches still let through songs in the wrong
language, covers, karaoke, "female versions" sung by someone else, mislabelled files and the like.

With this switched on, the daily GitHub build asks Claude (an AI model) about every song in every
ready-made playlist. Claude reads the **title, singer and album** and keeps only genuine original songs
from that playlist's language and film industry: Bollywood for Hindi, Hollywood for English,
Sandalwood for Kannada, and so on.

**It drops:**
- songs in another language or from another industry, including dubbed versions;
- covers, karaoke, instrumental and ringtone versions;
- re-sung "female/male/sad version" copies;
- mashups, medleys, jukeboxes and nonstop mixes;
- speeches, devotional recordings and comedy;
- junk file names like "Track 02".

On the **High Bass DJ** playlists, DJ remixes of real songs are kept on purpose.

## Switch it on (5 minutes)

1. Get an API key at <https://console.anthropic.com> → **API keys** (add a little credit under **Billing**).
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret** →
   name `ANTHROPIC_API_KEY`, value: the key.
3. Optional: a repository **variable** `AI_MODEL` to pick the model. The default is `claude-haiku-5-5`, fast and cheap for this kind of sorting.
4. Run **Actions → Deploy to GitHub Pages**. The log shows how many songs the AI removed from each playlist.

## Cost and speed

- **First run:** checks every song, roughly 20,000 across 21 languages, in batches of 60. This makes it the slowest and the only noticeable cost.
- **After that:** every answer is saved in `playlists.json`, so the daily run only asks about **new** songs, usually a few dozen.
- **Prices:** see <https://www.anthropic.com/pricing> (Haiku is the cheapest model). You can also set a monthly spend limit in the console.

## Safety

- **No key, or an API error:** playlists are built exactly as before, with nothing removed.
- **Too much removed:** if the AI would remove almost a whole playlist (more than 85%), that playlist is kept unfiltered and the log says so.
- **Unsure:** when Claude isn't sure about a well-known title, it keeps it.
- **What gets sent:** only song titles, singers and album names. No listener data ever goes to the AI.

The app also runs a quick free check of its own: it drops files named "Track 02", "01", ringtones,
jukeboxes and medleys, even for playlists it loads live.

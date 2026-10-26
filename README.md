# Cassette.fm

80s, 90s and 2000s Bollywood classics, nonstop. Free, no login, **no ads**.
An Angular app that streams audio straight from the [Internet Archive](https://archive.org).

## 📱 Android app

The same code also builds an Android app with offline downloads, background playback and
Spotify-style settings (colours, backgrounds, equaliser, sleep timer…). GitHub builds the APK
automatically — see **[ANDROID.md](ANDROID.md)**.

## Run it on your computer

```bash
npm install
npm start          # opens on http://localhost:4200
```

`npm run build` makes the production files in `dist/oldskool-fm/browser`.

## Put it online (GitHub Pages)

1. Push this folder to your GitHub repo (yours is `Oldskool.fm`; renaming the repo changes the link) (branch `main`).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` now builds and publishes the site automatically
   (see `.github/workflows/deploy.yml`). Watch it under the **Actions** tab.
4. Your link: `https://<your-github-username>.github.io/Oldskool.fm/`

> If you used the old single-file version, delete the old `index.html` and `.nojekyll`
> from the repo root. This project replaces them.

## Languages

The 🌐 switch in the header (just a globe on phones) changes the music language:
Hindi, English, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Punjabi, Gujarati, Odia,
Assamese and Bhojpuri. Each language searches only its Indian film industry
(Bollywood, Kollywood, Tollywood, Sandalwood, Mollywood, Pollywood, Dhollywood, Ollywood …).

**What never appears, in any language** (see `BLOCKED` in `archive.service.ts`): religious
recitations and devotional recordings of every faith, talks/lectures/podcasts, karaoke and
instrumental versions, Arabic-script uploads, and uploads from outside India. Languages live in `src/app/data/languages.ts`:

- `searchWords`: the archive.org words that mark that language's music
- `tagline`: the line under the headline
- Hindi uses the hand-made playlists in `stations.ts`; every other language gets the standard set
  in `stationsFor()` (Top Classics, 80s, 90s, 2000s, Romantic, Sad, Dance & Party, Everything).

## Everything playlists

Each language has an **Everything** playlist under *Explore*: the most played songs of that
language on the whole Internet Archive. The first 200 are ready instantly; **Load more songs** at the
bottom keeps pulling in the next albums from archive.org, as far as you want to go.

## Why playlists open instantly

Looking up a playlist on archive.org takes dozens of requests (and Nostalgic Long Drive hundreds),
which is slow. So it's done **ahead of time**: `scripts/build-playlists.ts` looks up every
playlist and saves them in `playlists.json`, which ships with the site. Visitors download that
one small file and every playlist opens in a fraction of a second.

- GitHub Actions runs it before every deploy **and once a day** (03:00 India time), so removed
  uploads drop out and new ones come in. If archive.org has a bad day, the previous lists are kept.
- Run it yourself with `npm run playlists` (writes `public/playlists.json`; needs internet).
  Without the file, e.g. on a fresh `npm start`, the site still works by looking songs up live.
- After changing `stations.ts` or `classical-drive.ts`, just push: the next deploy rebuilds the lists.

## Where things are

```
scripts/build-playlists.ts     ★ builds playlists.json at deploy time (npm run playlists)
src/
├── index.html                 page shell, fonts, loading screen
├── styles.scss                colour/type tokens + shared styles (glass, buttons, sliders)
└── app/
    ├── app.component.*        page layout, wires the components together
    ├── data/
    │   ├── stations.ts        ★ the menu: every playlist and its archive.org search
    │   └── classical-drive.ts ★ the hand-picked Nostalgic Long Drive song list
    ├── models/                TypeScript interfaces (Song, Station, archive.org responses)
    ├── services/
    │   ├── archive.service.ts      talks to archive.org (search, album songs, MP3 links)
    │   ├── library.service.ts      playlists: loading, cache, liked songs, search index
    │   ├── song-finder.service.ts  finds a named song ("Dil Ka Aalam" from "Aashiqui")
    │   ├── player.service.ts       the audio player: queue, shuffle, previous, lock screen
    │   ├── storage.service.ts      safe localStorage wrapper
    │   └── toast.service.ts        little pop-up messages
    ├── components/            one folder per UI piece, each with .ts / .html / .scss
    │   ├── header/            logo, search, "On air", menu button
    │   ├── search-box/        search across playlists + archive.org albums
    │   ├── player-card/       spinning record and controls
    │   ├── station-chips/     playlist buttons (desktop)
    │   ├── song-list/         songs of the open playlist
    │   ├── playlist-drawer/   the ☰ menu
    │   ├── mini-player/       bottom player on phones
    │   ├── tuning-popup/      "Tuning in…" when a song is slow to start
    │   ├── toast/             shows toast messages
    │   ├── bokeh-background/  dusk sky with drifting lights
    │   └── icon/              all SVG icons: <app-icon name="play" />
    └── utils/text.utils.ts    cleaning song names, time format, highlighting
```

State is kept in **signals** inside the services; components read them directly.
The app is zoneless (Angular 22 default), standalone components, `OnPush` everywhere.

## Change the menu

Open `src/app/data/stations.ts`. Each entry is one playlist:

```ts
{
  key: 'rom', group: 'Moods', name: 'Romantic', subtitle: 'Pyaar, ishq, mohabbat', mark: '♡', color: '#FF4F8B',
  query: `${HINDI} AND (romantic OR "love songs" OR love)`,
  backupQuery: `romantic AND (hindi OR bollywood)`,
},
```

- `group` is the menu heading (Start here, Eras, Moods). Order in the file = order in the menu.
- `query` is what gets searched on archive.org, most downloaded first. Try it on
  https://archive.org/search (choose **Audio**) first.
- `backupQuery` runs only if `query` finds fewer than 30 songs.
- `items: ['some-album-id']` pins albums (the ID is the part after `archive.org/details/`).
- `songList` plays a hand-picked list in order, like Nostalgic Long Drive.

## Nostalgic Long Drive

`src/app/data/classical-drive.ts` holds the song list. One line per song:

```ts
{ title: 'Dil Ka Aalam', artist: 'Kumar Sanu', film: 'Aashiqui' },
```

For each song the site opens the film's album on archive.org and picks the closest
track name (spelling differences like *Pyaara / Pyara* are handled). Songs without a
film are looked up by name. Songs that can't be found are skipped quietly.
Add, remove or reorder lines freely.

## Good to know

- Each visitor's browser remembers a playlist's songs for 3 days, so it opens instantly after the first visit.
- Liked songs and volume are saved in the visitor's own browser.
- Song quality and names depend on whoever uploaded them to archive.org.
- Many Bollywood uploads on archive.org are posted by fans, not by the music labels.
  The Archive removes uploads when rights holders ask, so songs come and go over time.

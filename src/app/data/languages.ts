import { Station } from '../models/station.model';
import { DJ_BASS_DB, DJ_WORDS } from './dj';
import { STATIONS } from './stations';

/** A language visitors can switch to. */
export interface Language {
  code: string;
  /** English name, e.g. "Tamil" */
  name: string;
  /** Name in its own script, e.g. "தமிழ்" — shown on the switch */
  native: string;
  /** The film / music industry its songs come from, e.g. "Kollywood". Shown next to the language. */
  industry: string;
  /** archive.org words that mark an upload as this industry's music (only these songs are fetched) */
  searchWords: string;
  /** Line under the headline */
  tagline: string;
  /** Regional / folk language: listed under "Regional" in the language switch */
  regional?: boolean;
}

/** The big film languages: an upload naming one of these belongs to that industry, not another one. */
const FILM_LANGUAGES = ['hindi', 'bollywood', 'tamil', 'kollywood', 'telugu', 'tollywood', 'kannada', 'sandalwood', 'malayalam', 'mollywood',
  'bengali', 'bangla', 'marathi', 'punjabi', 'pollywood', 'gujarati', 'odia', 'oriya', 'assamese', 'bhojpuri', 'haryanvi', 'rajasthani'];

/** Everything except the given words, as an archive.org NOT (…) list. */
function others(...own: string[]): string {
  return FILM_LANGUAGES.filter(w => !own.includes(w)).join(' OR ');
}

/**
 * One film industry's songs: the upload must name the language (or the industry) AND be film music,
 * and must NOT name another industry, so Tamil never shows Telugu dubs, Hindi never shows Bhojpuri, and so on.
 */
function film(language: string[], industryWords: string, extra = '', allow: string[] = []): string {
  return `((${language.join(' OR ')} OR ${industryWords}) AND (${industryWords} OR film OR filmi OR movie OR cinema OR soundtrack OR "film songs"${extra ? ' OR ' + extra : ''}) AND NOT (${others(...language, ...industryWords.split(' OR '), ...allow)}))`;
}

/**
 * A regional language whose music is mostly folk, pop and DJ songs (plus its own small film industry).
 * Uploads often also say "Hindi", so that word is allowed here; other industries' names are not.
 */
function folk(language: string[], extra = ''): string {
  return `((${language.join(' OR ')}) AND (song OR songs OR geet OR lok OR folk OR music OR dj OR film OR movie${extra ? ' OR ' + extra : ''}) AND NOT (${others(...language, 'hindi')}))`;
}

/*
 * Languages in the switch, in this order. Each one fetches songs ONLY from its own industry:
 * Hindi → Bollywood, English → Hollywood, Kannada → Sandalwood, Tamil → Kollywood, and so on.
 * Hindi uses the hand-made playlists in stations.ts; every other language gets the standard set below.
 * Religious, spoken-word and non-Indian uploads are blocked for all of them (archive.service.ts).
 */
export const LANGUAGES: Language[] = [
  { code: 'hi',  name: 'Hindi',     native: 'हिन्दी',   industry: 'Bollywood',  searchWords: '', tagline: "Bollywood's greatest hits from the 80s, 90s and 2000s, playing nonstop. No ads." },
  { code: 'en',  name: 'English',   native: 'English',  industry: 'Hollywood',
    searchWords: `((hollywood OR "motion picture soundtrack" OR "original motion picture" OR "original soundtrack" OR "movie soundtrack" OR "film soundtrack" OR ost) AND NOT (${others()} OR korean OR japanese OR anime OR chinese))`,
    tagline: 'Hollywood movie songs and soundtracks from the 80s, 90s and 2000s. No ads.' },
  { code: 'ta',  name: 'Tamil',     native: 'தமிழ்',    industry: 'Kollywood',   searchWords: film(['tamil'], 'kollywood', 'ilaiyaraaja OR "a r rahman"'), tagline: 'Kollywood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'te',  name: 'Telugu',    native: 'తెలుగు',   industry: 'Tollywood',   searchWords: film(['telugu'], 'tollywood'),                       tagline: 'Tollywood (Telugu) classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'kn',  name: 'Kannada',   native: 'ಕನ್ನಡ',    industry: 'Sandalwood',  searchWords: film(['kannada'], 'sandalwood'),                     tagline: 'Sandalwood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'ml',  name: 'Malayalam', native: 'മലയാളം',   industry: 'Mollywood',   searchWords: film(['malayalam'], 'mollywood'),                    tagline: 'Mollywood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'bn',  name: 'Bengali',   native: 'বাংলা',    industry: 'Tollygunge',  searchWords: film(['bengali', 'bangla'], 'tollygunge'),           tagline: 'Tollygunge (Bengali cinema) classics from Kolkata, 80s to 2000s. No ads.' },
  { code: 'mr',  name: 'Marathi',   native: 'मराठी',    industry: 'Marathi cinema', searchWords: film(['marathi'], '"marathi cinema"', 'lavani OR natyageet'), tagline: 'Marathi cinema classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'pa',  name: 'Punjabi',   native: 'ਪੰਜਾਬੀ',   industry: 'Pollywood',   searchWords: film(['punjabi'], 'pollywood', 'bhangra'),           tagline: 'Pollywood and bhangra classics from Indian Punjab. No ads.' },
  { code: 'gu',  name: 'Gujarati',  native: 'ગુજરાતી',  industry: 'Dhollywood',  searchWords: film(['gujarati'], 'dhollywood', 'garba'),           tagline: 'Dhollywood and garba classics from Gujarat. No ads.' },
  { code: 'or',  name: 'Odia',      native: 'ଓଡ଼ିଆ',     industry: 'Ollywood',    searchWords: film(['odia', 'oriya'], 'ollywood'),                  tagline: 'Ollywood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'as',  name: 'Assamese',  native: 'অসমীয়া',  industry: 'Jollywood',   searchWords: film(['assamese'], 'jollywood', 'bihu'),             tagline: 'Jollywood (Assamese cinema) and Bihu classics. No ads.' },

  // ---- Regional: each region's own film and folk music (listed under "Regional" in the switch)
  { code: 'bho', name: 'Bhojpuri',   native: 'भोजपुरी',   industry: 'Bhojiwood',          regional: true, searchWords: film(['bhojpuri'], 'bhojiwood', '', ['hindi']),          tagline: 'Bhojiwood (Bhojpuri cinema) hits, playing nonstop. No ads.' },
  { code: 'hry', name: 'Haryanvi',   native: 'हरियाणवी',  industry: 'Haryanvi music',     regional: true, searchWords: folk(['haryanvi', 'haryana'], 'ragni OR ragini'),  tagline: 'Haryanvi hits, ragnis and DJ bangers, playing nonstop. No ads.' },
  { code: 'raj', name: 'Rajasthani', native: 'राजस्थानी', industry: 'Rajasthani cinema',  regional: true, searchWords: folk(['rajasthani', 'marwari'], 'ghoomar OR banna'), tagline: 'Rajasthani cinema, Marwari folk and wedding favourites. No ads.' },
  { code: 'gbm', name: 'Garhwali',   native: 'गढ़वाली',   industry: 'Garhwali cinema',    regional: true, searchWords: folk(['garhwali', 'uttarakhand', 'pahadi'], 'jagar'), tagline: 'Garhwali cinema and Pahadi songs from Uttarakhand. No ads.' },
  { code: 'kfy', name: 'Kumaoni',    native: 'कुमाऊँनी',   industry: 'Kumaoni music',      regional: true, searchWords: folk(['kumaoni', 'kumauni', 'kumaon']),             tagline: 'Kumaoni songs from the hills of Uttarakhand. No ads.' },
  { code: 'kok', name: 'Konkani',    native: 'कोंकणी',    industry: 'Konkani cinema',     regional: true, searchWords: folk(['konkani', 'goan'], 'tiatr OR mando'),         tagline: 'Konkani cinema, Goan mandos and tiatr hits. No ads.' },
  { code: 'tcy', name: 'Tulu',       native: 'ತುಳು',       industry: 'Coastalwood',        regional: true, searchWords: folk(['tulu', 'tulunadu', 'coastalwood']),          tagline: 'Coastalwood (Tulu cinema) and Tulu songs from coastal Karnataka. No ads.' },
  { code: 'mai', name: 'Maithili',   native: 'मैथिली',    industry: 'Maithili cinema',    regional: true, searchWords: folk(['maithili', 'mithila'], 'vidyapati'),          tagline: 'Maithili cinema and songs from Mithila. No ads.' },
  { code: 'doi', name: 'Dogri',      native: 'डोगरी',     industry: 'Dogri music',        regional: true, searchWords: folk(['dogri'], 'pahari'),                           tagline: 'Dogri and Pahari songs from Jammu. No ads.' },
];

export const DEFAULT_LANGUAGE = 'hi';

/** The standard playlist set for a language (Hindi keeps its hand-made one). */
export function stationsFor(language: Language): Station[] {
  if (language.code === 'hi') return STATIONS;
  const w = language.searchWords;
  const s = (key: string, group: string, name: string, subtitle: string, mark: string, color: string, extra: string, badge?: string): Station => ({
    key: `${language.code}-${key}`, group, name, subtitle, mark, color, badge,
    query: `${w} AND (${extra})`, backupQuery: w,
  });
  return [
    s('top', 'Start here', 'Top Classics', `Most downloaded ${language.industry} evergreens`, '★', '#FFB36B', 'evergreen OR classics OR hits OR golden OR old', 'Most played'),
    s('80s', 'Eras', '80s Gold', `${language.industry} hits of the 80s`, '80', '#9B59FF', '80s OR 1980s OR 1985'),
    s('90s', 'Eras', '90s Hits', `${language.industry} hits of the 90s`, '90', '#FF6F91', '90s OR 1990s OR 1995'),
    s('00s', 'Eras', '2000s Nostalgia', `${language.industry} hits of the 2000s`, '00', '#5EC8FF', '2000s OR 2000 OR 2005'),
    s('rom', 'Moods', 'Romantic', 'Love songs', '♡', '#FF4F8B', 'romantic OR love OR melody OR melodies'),
    s('sad', 'Moods', 'Sad Songs', 'Heartbreak classics', '💔', '#5B6CFF', 'sad OR heartbreak OR pathos'),
    s('party', 'Moods', 'Dance & Party', 'Upbeat hits', '✦', '#FF9F43', 'dance OR party OR folk OR remix'),
    {
      ...s('dj', 'Moods', 'High Bass DJ', `${language.industry} DJ remixes with extra bass`, 'DJ', '#FF2D55', DJ_WORDS, 'Bass boost'),
      backupQuery: `${w} AND (dance OR party OR remix OR dj)`, bassBoost: DJ_BASS_DB,
    },
    { key: `${language.code}-all`, group: 'Explore', name: `Everything ${language.name}`, subtitle: `Every ${language.industry} song on the Archive, most played first`,
      mark: '∞', color: '#2FC4A0', endless: true, query: w },
  ];
}

/** Every language's playlists, so a saved song from another language can still be found after a refresh. */
export const ALL_STATIONS: Station[] = LANGUAGES.flatMap(stationsFor);

export function findLanguage(code: string): Language {
  return LANGUAGES.find(l => l.code === code) ?? LANGUAGES[0];
}

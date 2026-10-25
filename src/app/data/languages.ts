import { Station } from '../models/station.model';
import { STATIONS } from './stations';

/** A language visitors can switch to. */
export interface Language {
  code: string;
  /** English name, e.g. "Tamil" */
  name: string;
  /** Name in its own script, e.g. "தமிழ்" — shown on the switch */
  native: string;
  /** archive.org words that mark an upload as this language's film/pop music */
  searchWords: string;
  /** Line under the headline */
  tagline: string;
}

/** Search words for a language's Indian film/music industry, never other countries' uploads. */
function industry(language: string, extra: string): string {
  return `((${language}) AND (film OR movie OR cinema OR songs OR soundtrack OR ${extra}) AND NOT bhojpuri)`;
}

/*
 * Languages in the switch, in this order. Each one searches only that language's
 * Indian film industry (Bollywood, Sandalwood, Kollywood …). Hindi uses the hand-made
 * playlists in stations.ts; every other language gets the standard set below.
 * Religious, spoken-word and non-Indian uploads are blocked for all of them (archive.service.ts).
 */
export const LANGUAGES: Language[] = [
  { code: 'hi',  name: 'Hindi',     native: 'हिन्दी',   searchWords: '', tagline: "Bollywood's greatest hits from the 80s, 90s and 2000s, playing nonstop. No ads." },
  { code: 'en',  name: 'English',   native: 'English',  searchWords: '((english AND (pop OR rock OR hits OR oldies)) AND NOT bhojpuri)', tagline: 'English pop and rock classics from the 80s, 90s and 2000s. No ads.' },
  { code: 'ta',  name: 'Tamil',     native: 'தமிழ்',    searchWords: industry('tamil', 'kollywood OR ilaiyaraaja'),           tagline: 'Kollywood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'te',  name: 'Telugu',    native: 'తెలుగు',   searchWords: industry('telugu', 'tollywood'),                       tagline: 'Tollywood (Telugu) classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'kn',  name: 'Kannada',   native: 'ಕನ್ನಡ',    searchWords: industry('kannada', 'sandalwood'),                     tagline: 'Sandalwood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'ml',  name: 'Malayalam', native: 'മലയാളം',   searchWords: industry('malayalam', 'mollywood'),                    tagline: 'Mollywood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'bn',  name: 'Bengali',   native: 'বাংলা',    searchWords: industry('bengali OR bangla', 'tollygunge OR kolkata'), tagline: 'Bengali film classics from Kolkata, 80s to 2000s, playing nonstop. No ads.' },
  { code: 'mr',  name: 'Marathi',   native: 'मराठी',    searchWords: industry('marathi', 'lavani'),                         tagline: 'Marathi film classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'pa',  name: 'Punjabi',   native: 'ਪੰਜਾਬੀ',   searchWords: industry('punjabi', 'pollywood OR bhangra'),           tagline: 'Pollywood and bhangra classics from Indian Punjab. No ads.' },
  { code: 'gu',  name: 'Gujarati',  native: 'ગુજરાતી',  searchWords: industry('gujarati', 'dhollywood OR garba'),           tagline: 'Dhollywood and garba classics from Gujarat. No ads.' },
  { code: 'or',  name: 'Odia',      native: 'ଓଡ଼ିଆ',     searchWords: industry('odia OR oriya', 'ollywood'),                  tagline: 'Ollywood classics from the 80s, 90s and 2000s, playing nonstop. No ads.' },
  { code: 'as',  name: 'Assamese',  native: 'অসমীয়া',  searchWords: industry('assamese', 'jollywood OR bihu'),              tagline: 'Assamese film and Bihu classics. No ads.' },
  { code: 'bho', name: 'Bhojpuri',  native: 'भोजपुरी',  searchWords: '(bhojpuri AND (film OR movie OR cinema OR songs OR soundtrack))', tagline: 'Bhojpuri cinema hits, playing nonstop. No ads.' },
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
    s('top', 'Start here', 'Top Classics', `Most downloaded ${language.name} evergreens`, '★', '#FFB36B', 'evergreen OR classics OR hits OR golden OR old', 'Most played'),
    s('80s', 'Eras', '80s Gold', `${language.name} hits of the 80s`, '80', '#9B59FF', '80s OR 1980s OR 1985'),
    s('90s', 'Eras', '90s Hits', `${language.name} hits of the 90s`, '90', '#FF6F91', '90s OR 1990s OR 1995'),
    s('00s', 'Eras', '2000s Nostalgia', `${language.name} hits of the 2000s`, '00', '#5EC8FF', '2000s OR 2000 OR 2005'),
    s('rom', 'Moods', 'Romantic', 'Love songs', '♡', '#FF4F8B', 'romantic OR love OR melody OR melodies'),
    s('sad', 'Moods', 'Sad Songs', 'Heartbreak classics', '💔', '#5B6CFF', 'sad OR heartbreak OR pathos'),
    s('party', 'Moods', 'Dance & Party', 'Upbeat hits', '✦', '#FF9F43', 'dance OR party OR folk OR remix'),
    { key: `${language.code}-all`, group: 'Explore', name: `Everything ${language.name}`, subtitle: 'Every song on the Archive, most played first',
      mark: '∞', color: '#2FC4A0', endless: true, query: w },
  ];
}

/** Every language's playlists, so a saved song from another language can still be found after a refresh. */
export const ALL_STATIONS: Station[] = LANGUAGES.flatMap(stationsFor);

export function findLanguage(code: string): Language {
  return LANGUAGES.find(l => l.code === code) ?? LANGUAGES[0];
}

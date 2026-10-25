/** Small text helpers shared across the app. */

/** Site watermarks and filler words that uploaders add to song names. */
const JUNK_PATTERN = String.raw`\b(www\.)?[a-z0-9-]+\.(com|pk|in|net|org|info|co|me|cc|mobi|fm)\b` +
  String.raw`|\b(songs\s?pk|pagalworld|djmaza|mr-?jatt|downloadming|webmusic|mp3mad|songspk|bestwap|wapking|starmusiq|mp3skull|mymp3song|freshmaza|djpunjab)\b` +
  String.raw`|\b\d{2,3}\s?kbps\b` +
  String.raw`|\b(full song|full video|lyrical|official (video|audio)|official|hd|hq|mp3)\b`;
const JUNK_ALL = new RegExp(JUNK_PATTERN, 'ig');
const JUNK_ANY = new RegExp(JUNK_PATTERN, 'i');

/**
 * Turns a messy upload name into a clean song title.
 * "01 - Tujhe Dekha To [Songs.PK].mp3"  ->  "Tujhe Dekha To"
 */
export function cleanName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\.(mp3|ogg|m4a|flac|wav)$/i, '')
    .replace(/_/g, ' ')
    // drop bracketed parts that are only junk or only numbers: "[Songs.PK]", "(128 kbps)", "(1)"
    .replace(/[\[(]([^\])]*)[\])]/g, (whole, inner: string) =>
      JUNK_ANY.test(inner) || /^\s*\d*\s*$/.test(inner) ? ' ' : whole)
    .replace(JUNK_ALL, '')
    .replace(/^\s*(track\s*)?\d{1,3}\s*[-._)\]]?\s+/i, '') // leading track number
    .replace(/\s*[-–—|:]+\s*$/, '')
    .replace(/^\s*[-–—|:]+\s*/, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Lower-case, accent-free, punctuation-free text for searching and de-duplication. */
export function normalize(text: string | null | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 245 -> "4:05" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "245.3" or "04:05" -> seconds */
export function parseLength(value: string | undefined): number {
  if (!value) return 0;
  if (value.includes(':')) return value.split(':').reduce((total, part) => total * 60 + (Number(part) || 0), 0);
  return Number(value) || 0;
}

/** archive.org fields can be a string or a list of strings. */
export function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Splits text around the first match of `query`, for <mark> highlighting. */
export interface HighlightParts { before: string; match: string; after: string; }
export function highlight(text: string, query: string): HighlightParts {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return { before: text, match: '', after: '' };
  return { before: text.slice(0, at), match: text.slice(at, at + query.length), after: text.slice(at + query.length) };
}

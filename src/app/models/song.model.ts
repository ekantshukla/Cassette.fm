/** One playable song, taken from an Internet Archive item (album). */
export interface Song {
  /** archive.org item ID, the part after archive.org/details/ */
  itemId: string;
  /** File name inside the item, e.g. "01 Tujhe Dekha To.mp3" */
  file: string;
  title: string;
  artist: string;
  album: string;
}

/** A unique key for a song, used for likes, highlighting and de-duplication. */
export function songKey(song: Song): string {
  return `${song.itemId}/${song.file}`;
}

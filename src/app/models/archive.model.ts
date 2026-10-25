/** Shapes of the Internet Archive API responses this app reads. */

/** One result from archive.org search (an album or collection). */
export interface ArchiveDoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  downloads?: number;
}

export interface ArchiveSearchResponse {
  response?: { numFound: number; docs: ArchiveDoc[] };
}

export interface ArchiveScrapeResponse {
  items?: ArchiveDoc[];
}

/** One file inside an item, from archive.org/metadata/<id> */
export interface ArchiveFile {
  name: string;
  source?: 'original' | 'derivative' | 'metadata';
  format?: string;
  /** Seconds ("245.3") or "mm:ss" */
  length?: string;
  title?: string;
  artist?: string | string[];
  creator?: string | string[];
  track?: string;
  private?: string | boolean;
}

export interface ArchiveMetadataResponse {
  files?: ArchiveFile[];
  metadata?: {
    title?: string | string[];
    creator?: string | string[];
    'access-restricted-item'?: string | boolean;
  };
  is_dark?: boolean;
}

import { Injectable } from '@angular/core';

/**
 * Safe wrapper around localStorage. Private windows and blocked storage
 * throw errors, so every read and write is guarded and falls back quietly.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  /** Returns false when the browser refused to save (for example, storage is full). */
  set(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  }
}

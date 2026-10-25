import { Injectable, signal } from '@angular/core';

/** Small bits of screen state shared by components that sit in different places on the page. */
@Injectable({ providedIn: 'root' })
export class UiService {
  /** The music-language list (opened from the switch in the header, drawn at page level). */
  readonly languageOpen = signal(false);
}

import { Injectable, inject, signal } from '@angular/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

import { NativeService } from './native.service';

/** Browser speech recognition (Chrome, Edge, Safari), typed just as far as used here. */
interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => BrowserRecognition;

/**
 * "Speak to search" for the mic in the search bar.
 *  - Android app: Android's own speech recognition (the Google "Speak now" box).
 *  - Website: the browser's speech recognition, where it exists (Chrome, Edge, Safari).
 * English (India) understands song names said in Hindi, Tamil, Kannada … and writes them in English
 * letters, which is how song titles are written in the playlists.
 */
@Injectable({ providedIn: 'root' })
export class VoiceSearchService {
  private readonly native = inject(NativeService);
  private readonly Recognition: RecognitionCtor | undefined = typeof window === 'undefined' ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);

  /** A mic can be offered on this device. */
  readonly supported = signal(this.native.isApp || !!this.Recognition);
  readonly listening = signal(false);
  private browser?: BrowserRecognition;

  constructor() {
    if (this.native.isApp) {
      SpeechRecognition.available().then(r => this.supported.set(r.available)).catch(() => this.supported.set(false));
    }
  }

  /**
   * Listens once. `onText` gets the words while speaking (website) and the final words.
   * Rejects with a message the listener can read.
   */
  async listen(onText: (text: string, final: boolean) => void): Promise<void> {
    if (this.listening()) { this.stop(); return; }
    return this.native.isApp ? this.listenApp(onText) : this.listenBrowser(onText);
  }

  stop(): void {
    this.listening.set(false);
    if (this.native.isApp) SpeechRecognition.stop().catch(() => undefined);
    else this.browser?.stop();
  }

  private async listenApp(onText: (text: string, final: boolean) => void): Promise<void> {
    const perm = await SpeechRecognition.checkPermissions().catch(() => null);
    if (perm?.speechRecognition !== 'granted') {
      const asked = await SpeechRecognition.requestPermissions().catch(() => null);
      if (asked?.speechRecognition !== 'granted') throw new Error('Allow the microphone to search by voice.');
    }
    this.listening.set(true);
    try {
      const { matches } = await SpeechRecognition.start({
        language: 'en-IN', maxResults: 3, prompt: 'Say a song, film or singer', partialResults: false, popup: true,
      });
      const best = matches?.[0];
      if (best) onText(cleanSpoken(best), true);
    } catch (err) {
      // Closing the "Speak now" box or saying nothing isn't an error worth showing.
      if (!/cancel|no match|didn't understand|no speech|7|11/i.test(String((err as Error)?.message ?? err))) {
        throw new Error("Couldn't hear that. Try again.");
      }
    } finally {
      this.listening.set(false);
    }
  }

  private listenBrowser(onText: (text: string, final: boolean) => void): Promise<void> {
    if (!this.Recognition) return Promise.reject(new Error("Voice search isn't available in this browser."));
    return new Promise((resolve, reject) => {
      const rec = new this.Recognition!();
      this.browser = rec;
      rec.lang = 'en-IN';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let finalText = '';
      rec.onresult = e => {
        let text = '';
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          final = e.results[i].isFinal;
        }
        if (final) finalText = text;
        onText(cleanSpoken(text), final);
      };
      rec.onerror = e => {
        this.listening.set(false);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') reject(new Error('Allow the microphone to search by voice.'));
        else if (e.error === 'no-speech' || e.error === 'aborted') resolve();
        else reject(new Error("Couldn't hear that. Try again."));
      };
      rec.onend = () => {
        this.listening.set(false);
        resolve();
        void finalText;
      };
      this.listening.set(true);
      try {
        rec.start();
      } catch {
        this.listening.set(false);
        reject(new Error("Couldn't start the microphone."));
      }
    });
  }
}

/** "Play Tujhe Dekha To song." → "Tujhe Dekha To" */
export function cleanSpoken(text: string): string {
  return text
    .trim()
    .replace(/[.?!]+$/, '')
    .replace(/^(please\s+)?(play|search( for)?|find|put on|bajao|chalao|lagao)\s+(the\s+)?/i, '')
    .replace(/\s+(song|songs|gaana|gana|gaane|bajao|chalao|lagao|please)$/i, '')
    .trim();
}

import { Injectable, signal } from '@angular/core';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';

/** Our own Android plugin (android/app/src/main/java/fm/cassette/app/PlaybackPlugin.java). */
interface PlaybackPlugin {
  update(options: { title: string; artist: string; playing: boolean }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'action', handler: (data: { action: 'toggle' | 'next' | 'previous' }) => void): Promise<PluginListenerHandle>;
}
const Playback = registerPlugin<PlaybackPlugin>('Playback');

/**
 * Everything that differs between the website and the Android app.
 *  - isApp:      true inside the Android app
 *  - online/wifi: internet state (the app uses Android's own, the website the browser's)
 *  - nowPlaying(): the "Now playing" notification that also keeps music going with the screen off
 *  - onBack():   the phone's back button
 */
@Injectable({ providedIn: 'root' })
export class NativeService {
  readonly isApp = Capacitor.isNativePlatform();
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  /** True on Wi-Fi (or a cable). On the website this can't be known, so it's assumed. */
  readonly wifi = signal(true);

  constructor() {
    if (typeof window === 'undefined') return; // build script
    if (this.isApp) {
      Network.getStatus().then(s => this.setNetwork(s.connected, s.connectionType)).catch(() => undefined);
      Network.addListener('networkStatusChange', s => this.setNetwork(s.connected, s.connectionType)).catch(() => undefined);
    } else {
      addEventListener('online', () => this.online.set(true));
      addEventListener('offline', () => this.online.set(false));
      const connection = (navigator as Navigator & { connection?: { type?: string; addEventListener?: (e: string, f: () => void) => void } }).connection;
      const readType = () => this.wifi.set(!connection?.type || connection.type !== 'cellular');
      readType();
      connection?.addEventListener?.('change', readType);
    }
  }

  /** Shows / updates the notification. Safe to call often. */
  nowPlaying(title: string, artist: string, playing: boolean): void {
    if (this.isApp) Playback.update({ title, artist, playing }).catch(() => undefined);
  }

  stopNowPlaying(): void {
    if (this.isApp) Playback.stop().catch(() => undefined);
  }

  /** Buttons pressed on the notification. */
  onNotificationButton(handler: (action: 'toggle' | 'next' | 'previous') => void): void {
    if (this.isApp) Playback.addListener('action', d => handler(d.action)).catch(() => undefined);
  }

  /**
   * The phone's back button. `handler` returns true if it closed something (a menu, a panel).
   * Otherwise the app goes to the background — and keeps playing — instead of closing.
   */
  onBack(handler: () => boolean): void {
    if (!this.isApp) return;
    App.addListener('backButton', () => { if (!handler()) App.minimizeApp().catch(() => undefined); }).catch(() => undefined);
  }

  /** Path of a file inside the app, usable as <audio src> or <img src>. */
  fileSrc(uri: string): string {
    return Capacitor.convertFileSrc(uri);
  }

  private setNetwork(connected: boolean, type: string): void {
    this.online.set(connected);
    this.wifi.set(type === 'wifi');
  }
}

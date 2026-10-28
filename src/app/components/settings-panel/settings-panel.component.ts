import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal } from '@angular/core';

import { APK_URL, APP_VERSION } from '../../data/app-info';
import { DOWNLOADS_STATION } from '../../data/stations';
import { AccountService, friendlyAuthError } from '../../services/account.service';
import { DownloadsService } from '../../services/downloads.service';
import { NativeService } from '../../services/native.service';
import { PlayerService } from '../../services/player.service';
import { ACCENTS, EQ_CUSTOM, EQ_LABELS, EQ_PRESETS, SKIES, SPACES, SPEEDS, SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { LibraryService } from '../../services/library.service';
import { UiService } from '../../services/ui.service';
import { CollectionsService } from '../../services/collections.service';
import { SpotifyService } from '../../services/spotify.service';
import { formatBytes } from '../../utils/text.utils';
import { IconComponent } from '../icon/icon.component';

/**
 * Settings: look (colour, background), sound (equaliser, loudness, fades),
 * sleep timer and downloads. Opened from ⚙ in the header.
 */
@Component({
  selector: 'app-settings-panel',
  imports: [IconComponent],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
})
export class SettingsPanelComponent {
  protected readonly settings = inject(SettingsService);
  protected readonly downloads = inject(DownloadsService);
  protected readonly player = inject(PlayerService);
  protected readonly native = inject(NativeService);
  protected readonly account = inject(AccountService);
  protected readonly spotify = inject(SpotifyService);
  protected readonly library = inject(LibraryService);
  private readonly ui = inject(UiService);

  protected openLanguages(): void {
    this.close();
    this.ui.languageOpen.set(true);
  }
  private readonly collections = inject(CollectionsService);
  protected readonly historyCount = computed(() => Object.keys(this.collections.plays()).length);
  protected readonly confirmClear = signal(false);

  protected clearHistory(): void {
    if (!this.confirmClear()) {
      this.confirmClear.set(true);
      setTimeout(() => this.confirmClear.set(false), 3500);
      return;
    }
    this.confirmClear.set(false);
    this.collections.clearHistory();
    this.toast.show('Listening history cleared');
  }
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly accents = ACCENTS;
  protected readonly skies = SKIES;
  protected readonly presets = EQ_PRESETS;
  protected readonly custom = EQ_CUSTOM;
  protected readonly bandLabels = EQ_LABELS;
  protected readonly spaces = SPACES;
  protected readonly speeds = SPEEDS;
  protected readonly sleepChoices = [15, 30, 45, 60, 90];
  protected readonly fadeChoices = [0, 3, 6, 9, 12];
  protected readonly apkUrl = APK_URL;
  protected readonly version = APP_VERSION;

  protected readonly storageText = computed(() => {
    const n = this.downloads.count();
    return n ? `${n} ${n === 1 ? 'song' : 'songs'} · ${formatBytes(this.downloads.totalBytes())}` : 'No songs downloaded yet';
  });

  private readonly confirmRemove = signal(false);
  protected readonly removeLabel = computed(() => (this.confirmRemove() ? 'Tap again to remove all' : 'Remove all downloads'));

  /** Android: notifications are off, so there are no controls on the lock screen. */
  protected readonly notificationsOff = signal(false);

  protected openNotificationSettings(): void {
    this.native.openNotificationSettings();
  }

  constructor() {
    effect(() => {
      if (this.settings.open() && this.native.isApp) this.native.notificationsAllowed().then(ok => this.notificationsOff.set(!ok));
    });
    // Jump to a section when opened from a shortcut (the moon on the player).
    effect(() => {
      if (!this.settings.open()) return;
      const section = this.settings.section();
      setTimeout(() => {
        const el = this.host.nativeElement;
        const target = section ? el.querySelector<HTMLElement>(`[data-section="${section}"]`) : null;
        if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        else el.querySelector('.body')?.scrollTo({ top: 0 });
        el.querySelector<HTMLElement>('.close')?.focus({ preventScroll: true });
      }, 60);
    });
  }

  // ---- account
  protected readonly editingName = signal(false);
  private readonly confirmDelete = signal(false);
  protected readonly deleteLabel = computed(() => (this.confirmDelete() ? 'Tap again to delete your account' : 'Delete account'));
  protected readonly syncText = computed(() => ({
    idle: '', syncing: 'Saving…',
    synced: this.account.demo ? 'Demo account · saved on this device' : 'Likes, playlists & settings backed up',
    error: "Couldn't back up right now. Will retry.",
  })[this.account.sync()]);

  protected openSignIn(): void {
    this.close();
    this.account.screenOpen.set(true);
  }

  protected async pickPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await this.account.setPhoto(file);
      this.toast.show('Profile photo updated');
    } catch {
      this.toast.show("That picture couldn't be used. Try a JPG or PNG photo.");
    }
  }

  protected async removePhoto(): Promise<void> {
    await this.account.removePhoto();
    this.toast.show('Profile photo removed');
  }

  protected async saveName(name: string): Promise<void> {
    this.editingName.set(false);
    if (name.trim() && name.trim() !== this.account.displayName()) {
      await this.account.updateName(name).catch(() => this.toast.show("Couldn't change your name. Try again."));
    }
  }

  protected async logOut(): Promise<void> {
    await this.account.signOut().catch(() => this.toast.show("Couldn't log out. Try again."));
  }

  protected async deleteAccount(): Promise<void> {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      setTimeout(() => this.confirmDelete.set(false), 4000);
      return;
    }
    this.confirmDelete.set(false);
    try {
      await this.account.deleteAccount();
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      // Firebase asks for a fresh log-in before deleting an account.
      this.toast.show(/recent|requires-recent-login/i.test(msg) ? 'For safety, log out and log in again, then delete.' : friendlyAuthError(err), 4000);
    }
  }

  close(): void {
    this.settings.open.set(false);
  }

  protected setSleep(choice: number | 'song' | null): void {
    this.player.setSleepTimer(choice);
  }

  protected openDownloads(): void {
    this.close();
    this.player.playStation(DOWNLOADS_STATION);
  }

  protected removeAll(): void {
    if (!this.confirmRemove()) {
      this.confirmRemove.set(true);
      setTimeout(() => this.confirmRemove.set(false), 3500);
      return;
    }
    this.confirmRemove.set(false);
    this.downloads.removeAll().then(() => this.toast.show('All downloads removed'));
  }

  protected resetLook(): void {
    this.settings.resetAll();
    this.toast.show('Settings reset');
  }

  protected readonly balanceText = computed(() => {
    const b = this.settings.balance();
    return b === 0 ? 'Centre' : b < 0 ? `Left ${-b}%` : `Right ${b}%`;
  });

  /** A smooth line through the equaliser sliders (plus bass and treble), drawn behind them. */
  protected readonly curvePath = computed(() => {
    const gains = this.settings.eqGains().map((g, i, all) =>
      g + (i < 3 ? this.settings.bass() * (1 - i / 3) : 0) + (i > all.length - 4 ? this.settings.treble() * ((i - (all.length - 4)) / 3) : 0));
    const pts = gains.map((g, i) => [5 + (i * 90) / (gains.length - 1), 20 - Math.max(-18, Math.min(18, g)) * (18 / 18)]);
    return pts.reduce((d, [x, y], i) => {
      if (!i) return `M${x},${y}`;
      const [px, py] = pts[i - 1];
      const mx = (px + x) / 2;
      return `${d} C${mx},${py} ${mx},${y} ${x},${y}`;
    }, '');
  });

  protected savePreset(name: string): void {
    this.settings.saveMyPreset(name);
    this.toast.show('Saved to your presets ★');
  }

  protected resetSound(): void {
    this.settings.resetSound();
    this.toast.show('Sound reset');
  }

  protected bandValue(i: number): number {
    return this.settings.eqGains()[i] ?? 0;
  }
}

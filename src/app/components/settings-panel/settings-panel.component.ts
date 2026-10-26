import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal } from '@angular/core';

import { APK_URL, APP_VERSION } from '../../data/app-info';
import { DOWNLOADS_STATION } from '../../data/stations';
import { AccountService, friendlyAuthError } from '../../services/account.service';
import { DownloadsService } from '../../services/downloads.service';
import { NativeService } from '../../services/native.service';
import { PlayerService } from '../../services/player.service';
import { ACCENTS, EQ_CUSTOM, EQ_LABELS, EQ_PRESETS, SKIES, SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
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
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly accents = ACCENTS;
  protected readonly skies = SKIES;
  protected readonly presets = EQ_PRESETS;
  protected readonly custom = EQ_CUSTOM;
  protected readonly bandLabels = EQ_LABELS;
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

  constructor() {
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
    idle: '', syncing: 'Saving…', synced: 'Liked songs & settings backed up', error: "Couldn't back up right now. Will retry.",
  })[this.account.sync()]);

  protected openSignIn(): void {
    this.close();
    this.account.screenOpen.set(true);
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

  protected bandValue(i: number): number {
    return this.settings.eqGains()[i] ?? 0;
  }
}

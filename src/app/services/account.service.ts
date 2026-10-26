import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { PluginListenerHandle, registerPlugin } from '@capacitor/core';

import { ACCOUNTS_ENABLED, PHONE_SIGN_IN, REQUIRE_SIGN_IN } from '../data/app-info';
import { Song, songKey } from '../models/song.model';
import { LibraryService } from './library.service';
import { NativeService } from './native.service';
import { SavedSettings, SettingsService } from './settings.service';
import { StorageService } from './storage.service';
import { ToastService } from './toast.service';

/* ---- The two Firebase plugins, typed just as far as this app uses them ----
 * (Reached by name, so the website and builds without Firebase never load them.) */

export interface AccountUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  phoneNumber: string | null;
  photoUrl: string | null;
  emailVerified: boolean;
  providerData?: Array<{ providerId: string }>;
}
interface SignInResult { user: AccountUser | null; }

interface FirebaseAuthenticationPlugin {
  getCurrentUser(): Promise<SignInResult>;
  createUserWithEmailAndPassword(o: { email: string; password: string }): Promise<SignInResult>;
  signInWithEmailAndPassword(o: { email: string; password: string }): Promise<SignInResult>;
  sendPasswordResetEmail(o: { email: string }): Promise<void>;
  sendEmailVerification(): Promise<void>;
  updateProfile(o: { displayName?: string | null }): Promise<void>;
  signInWithGoogle(): Promise<SignInResult>;
  signInWithPhoneNumber(o: { phoneNumber: string; resendCode?: boolean; timeout?: number }): Promise<void>;
  confirmVerificationCode(o: { verificationId: string; verificationCode: string }): Promise<SignInResult>;
  reload(): Promise<void>;
  signOut(): Promise<void>;
  deleteUser(): Promise<void>;
  useAppLanguage(): Promise<void>;
  addListener(e: 'authStateChange', f: (c: { user: AccountUser | null }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'phoneCodeSent', f: (c: { verificationId: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'phoneVerificationCompleted', f: (c: SignInResult) => void): Promise<PluginListenerHandle>;
  addListener(e: 'phoneVerificationFailed', f: (c: { message: string }) => void): Promise<PluginListenerHandle>;
}
interface FirebaseFirestorePlugin {
  getDocument<T>(o: { reference: string }): Promise<{ snapshot: { data: T | null } }>;
  setDocument(o: { reference: string; data: object; merge?: boolean }): Promise<void>;
  deleteDocument(o: { reference: string }): Promise<void>;
}
const Auth = registerPlugin<FirebaseAuthenticationPlugin>('FirebaseAuthentication');
const Store = registerPlugin<FirebaseFirestorePlugin>('FirebaseFirestore');

/** What's kept in the account (Firestore: users/<uid>). */
interface CloudData {
  name?: string;
  liked?: Song[];
  settings?: Partial<SavedSettings>;
  updatedAt?: number;
  createdAt?: number;
}

const KEY_SKIPPED = 'cfm.account.skipped';
/** Wait this long after a change before saving it to the account. */
const SAVE_DELAY_MS = 2500;

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

/**
 * Listener accounts in the Android app: sign up / log in with email + password,
 * phone number + OTP, or Google. Liked songs and settings are backed up to the account,
 * so they come back on a new phone. Downloads stay on each phone.
 */
@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly native = inject(NativeService);
  private readonly library = inject(LibraryService);
  private readonly settings = inject(SettingsService);
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  /** Accounts exist in this build (Android app with Firebase set up). */
  readonly enabled = this.native.isApp && ACCOUNTS_ENABLED;
  readonly phoneEnabled = PHONE_SIGN_IN;
  readonly required = REQUIRE_SIGN_IN;

  readonly user = signal<AccountUser | null>(null);
  /** False until the app knows whether someone is signed in. */
  readonly ready = signal(!this.enabled);
  readonly sync = signal<SyncState>('idle');
  /** The sign-up / log-in screen. */
  readonly screenOpen = signal(false);

  readonly signedIn = computed(() => !!this.user());
  readonly displayName = computed(() => {
    const u = this.user();
    return u?.displayName || u?.email?.split('@')[0] || u?.phoneNumber || 'Listener';
  });
  readonly initials = computed(() =>
    this.displayName().split(/[\s._@+-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '♪');
  readonly contact = computed(() => this.user()?.email || this.user()?.phoneNumber || '');

  /** Phone sign-in in progress: the ID Firebase gives once the OTP text is sent. */
  readonly verificationId = signal<string | null>(null);
  private phoneWaiter?: { resolve: () => void; reject: (e: Error) => void };

  /** Account data loaded and merged; from now on local changes are saved to it. */
  private loadedUid: string | null = null;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    if (!this.enabled) return;

    Auth.useAppLanguage().catch(() => undefined);
    Auth.addListener('authStateChange', ({ user }) => this.onUser(user)).catch(() => undefined);
    Auth.getCurrentUser()
      .then(({ user }) => this.onUser(user))
      .catch(() => this.onUser(null))
      .finally(() => {
        this.ready.set(true);
        // First launch (or "required" mode): show the welcome screen.
        if (!this.user() && (this.required || !this.storage.get(KEY_SKIPPED, false))) this.screenOpen.set(true);
      });

    Auth.addListener('phoneCodeSent', ({ verificationId }) => {
      this.verificationId.set(verificationId);
      this.phoneWaiter?.resolve();
      this.phoneWaiter = undefined;
    }).catch(() => undefined);
    Auth.addListener('phoneVerificationFailed', ({ message }) => {
      this.phoneWaiter?.reject(new Error(message));
      this.phoneWaiter = undefined;
    }).catch(() => undefined);
    // Android sometimes reads the OTP text by itself and signs in straight away.
    Auth.addListener('phoneVerificationCompleted', () => {
      this.phoneWaiter?.resolve();
      this.phoneWaiter = undefined;
    }).catch(() => undefined);

    // Back up likes and settings whenever they change (once the account's data is loaded).
    effect(() => {
      this.library.liked();
      this.settings.snapshot();
      untracked(() => this.scheduleSave());
    });
  }

  /** "Not now" on the welcome screen. */
  skip(): void {
    if (this.required) return;
    this.storage.set(KEY_SKIPPED, true);
    this.screenOpen.set(false);
  }

  // ---- sign up / log in ---------------------------------------------------

  async signUpWithEmail(name: string, email: string, password: string): Promise<void> {
    await Auth.createUserWithEmailAndPassword({ email: email.trim(), password });
    if (name.trim()) await Auth.updateProfile({ displayName: name.trim() }).catch(() => undefined);
    Auth.sendEmailVerification().catch(() => undefined);
    await this.refreshUser();
    this.welcome(true);
  }

  async logInWithEmail(email: string, password: string): Promise<void> {
    await Auth.signInWithEmailAndPassword({ email: email.trim(), password });
    this.welcome(false);
  }

  resetPassword(email: string): Promise<void> {
    return Auth.sendPasswordResetEmail({ email: email.trim() });
  }

  async continueWithGoogle(): Promise<void> {
    await Auth.signInWithGoogle();
    this.welcome(false);
  }

  /** Sends the OTP. Resolves when the text is on its way (or Android already verified the number). */
  sendOtp(phoneNumber: string, resend = false): Promise<void> {
    this.verificationId.set(null);
    return new Promise<void>((resolve, reject) => {
      this.phoneWaiter = { resolve, reject };
      Auth.signInWithPhoneNumber({ phoneNumber, resendCode: resend, timeout: 60 }).catch(err => {
        this.phoneWaiter = undefined;
        reject(err);
      });
    });
  }

  async confirmOtp(code: string): Promise<void> {
    const verificationId = this.verificationId();
    if (!verificationId) throw new Error('auth/missing-verification-id');
    await Auth.confirmVerificationCode({ verificationId, verificationCode: code.trim() });
    this.verificationId.set(null);
    this.welcome(false);
  }

  // ---- signed in ----------------------------------------------------------

  async updateName(name: string): Promise<void> {
    await Auth.updateProfile({ displayName: name.trim() || null });
    await this.refreshUser();
    this.scheduleSave(0);
  }

  async signOut(): Promise<void> {
    await this.saveNow();
    await Auth.signOut();
    this.loadedUid = null;
    this.toast.show('Logged out. Your downloads stay on this phone.');
    if (this.required) this.screenOpen.set(true);
  }

  /** Deletes the account and its backed-up data. Likes and downloads stay on this phone. */
  async deleteAccount(): Promise<void> {
    const uid = this.user()?.uid;
    if (!uid) return;
    clearTimeout(this.saveTimer);
    await Store.deleteDocument({ reference: `users/${uid}` }).catch(() => undefined);
    await Auth.deleteUser();
    this.loadedUid = null;
    this.toast.show('Account deleted');
    if (this.required) this.screenOpen.set(true);
  }

  // ---- private ------------------------------------------------------------

  private welcome(isNew: boolean): void {
    this.screenOpen.set(false);
    this.toast.show(isNew ? `Welcome to Cassette.fm, ${this.displayName()} ♥` : `Welcome back, ${this.displayName()}`, 2800);
  }

  private async refreshUser(): Promise<void> {
    await Auth.reload().catch(() => undefined);
    const { user } = await Auth.getCurrentUser().catch(() => ({ user: null }));
    if (user) this.user.set({ ...user });
  }

  private onUser(user: AccountUser | null): void {
    const before = this.user()?.uid ?? null;
    this.user.set(user);
    if (user && user.uid !== before) this.loadFromCloud(user.uid);
    if (!user) { this.loadedUid = null; this.sync.set('idle'); }
  }

  /** On sign-in: bring back the account's likes and settings, merged with this phone's. */
  private async loadFromCloud(uid: string): Promise<void> {
    this.sync.set('syncing');
    try {
      const { snapshot } = await Store.getDocument<CloudData>({ reference: `users/${uid}` });
      const cloud = snapshot.data;
      if (this.user()?.uid !== uid) return;
      if (cloud?.liked?.length) {
        // Keep both: the account's likes first, then any liked on this phone only.
        const keys = new Set(cloud.liked.map(songKey));
        this.library.replaceLiked([...cloud.liked, ...this.library.liked().filter(s => !keys.has(songKey(s)))]);
      }
      if (cloud?.settings) this.settings.restore(cloud.settings);
      this.loadedUid = uid;
      await this.saveNow(!cloud);
      this.sync.set('synced');
    } catch {
      this.loadedUid = uid; // still save from now on
      this.sync.set('error');
    }
  }

  private scheduleSave(delay = SAVE_DELAY_MS): void {
    if (!this.loadedUid) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), delay);
  }

  private async saveNow(isNew = false): Promise<void> {
    clearTimeout(this.saveTimer);
    const uid = this.loadedUid;
    if (!uid || this.user()?.uid !== uid) return;
    const data: CloudData = {
      name: this.displayName(),
      liked: this.library.liked(),
      settings: this.settings.snapshot(),
      updatedAt: Date.now(),
      ...(isNew ? { createdAt: Date.now() } : {}),
    };
    try {
      this.sync.set('syncing');
      await Store.setDocument({ reference: `users/${uid}`, data, merge: true });
      this.sync.set('synced');
    } catch {
      this.sync.set('error');
    }
  }
}

/** Firebase error → a sentence a listener understands. */
export function friendlyAuthError(err: unknown): string {
  const text = `${(err as { code?: string })?.code ?? ''} ${(err as Error)?.message ?? err}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/email-already-in-use|already in use/, 'That email already has an account. Log in instead.'],
    [/invalid-email|badly formatted/, "That email doesn't look right."],
    [/weak-password|at least 6/, 'Use a password with at least 6 characters.'],
    [/wrong-password|invalid-credential|incorrect|malformed or has expired/, 'Wrong email or password.'],
    [/user-not-found|no user record/, 'No account with that email. Sign up instead.'],
    [/too-many-requests|blocked all requests|unusual activity/, 'Too many tries. Please wait a few minutes.'],
    [/invalid-verification-code|sms code has expired|code.*invalid/, "That code didn't match. Check the SMS and try again."],
    [/invalid-phone-number|phone number.*(invalid|format)/, "That phone number doesn't look right."],
    [/quota|billing|operation-not-allowed|not enabled/, "This sign-in option isn't available right now. Try another one."],
    [/network|unreachable|timeout|offline/, "Can't connect. Check your internet."],
    [/cancel|12501|user canceled|closed/, ''],
  ];
  for (const [pattern, message] of rules) if (pattern.test(text)) return message;
  return 'Something went wrong. Please try again.';
}

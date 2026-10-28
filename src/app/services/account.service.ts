import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { PluginListenerHandle, registerPlugin } from '@capacitor/core';

import { ACCOUNTS_ENABLED, FIREBASE_WEB_CONFIG, PHONE_SIGN_IN, REQUIRE_SIGN_IN } from '../data/app-info';
import { webAuth, webStore } from './firebase-web';
import { Song, songKey } from '../models/song.model';
import { LibrarySnapshot } from './collections.service';
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

export interface FirebaseAuthenticationPlugin {
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
export interface FirebaseFirestorePlugin {
  getDocument<T>(o: { reference: string }): Promise<{ snapshot: { data: T | null } }>;
  setDocument(o: { reference: string; data: object; merge?: boolean }): Promise<void>;
  deleteDocument(o: { reference: string }): Promise<void>;
}
/** Android app: the native Firebase plugins. Website: swapped for the Firebase JS SDK (firebase-web.ts). */
let Auth = registerPlugin<FirebaseAuthenticationPlugin>('FirebaseAuthentication');
let Store = registerPlugin<FirebaseFirestorePlugin>('FirebaseFirestore');

/** The website's Firebase settings (JSON from the Firebase console), or null. */
function webConfig(): object | null {
  try { return FIREBASE_WEB_CONFIG ? (JSON.parse(FIREBASE_WEB_CONFIG) as object) : null; } catch { return null; }
}

/** What's kept in the account (Firestore: users/<uid>). */
interface CloudData {
  name?: string;
  liked?: Song[];
  settings?: Partial<SavedSettings>;
  /** Profile photo: a small JPEG as a data: URL (about 15 KB), so no paid file storage is needed. */
  photo?: string | null;
  /** Own playlists, play history and pins (Library). */
  library?: LibrarySnapshot;
  updatedAt?: number;
  createdAt?: number;
}

const KEY_SKIPPED = 'cfm.account.skipped';
/** Demo accounts (no Firebase): kept on this device only. */
const KEY_DEMO_USERS = 'cfm.demo.users';
const KEY_DEMO_SESSION = 'cfm.demo.session';
/** The OTP every demo phone sign-in accepts (shown on screen). */
export const DEMO_OTP = '123456';

interface DemoUser {
  uid: string;
  name: string;
  email: string | null;
  phone: string | null;
  salt: string;
  hash: string;
  createdAt: number;
  data?: CloudData;
}

/** Thrown like Firebase does, so friendlyAuthError() understands it. */
function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const b of bytes) h = (h * 31 + b) | 0; // very old browsers only
  return String(h);
}
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

  /** Android app with Firebase set up (google-services.json): native sign-in. */
  private readonly nativeCloud = this.native.isApp && ACCOUNTS_ENABLED;
  /** Website with Firebase set up (FIREBASE_WEB_CONFIG): sign-in through the Firebase JS SDK. */
  private readonly webCloud = !this.native.isApp && !!webConfig();
  /** Real accounts (Firebase), on the app or the website. */
  readonly cloud = this.nativeCloud || this.webCloud;
  /**
   * Without Firebase (the website, or an app built without it) accounts still work as
   * demo accounts: sign up / log in / phone OTP, kept on this device only.
   */
  readonly demo = !this.cloud;
  /** Accounts are always on now: real ones, or demo ones. */
  readonly enabled = true;
  readonly phoneEnabled = (this.nativeCloud && PHONE_SIGN_IN) || this.demo;
  readonly googleEnabled = this.cloud;
  readonly demoOtp = DEMO_OTP;
  readonly required = REQUIRE_SIGN_IN;

  readonly user = signal<AccountUser | null>(null);
  /** The listener's own profile photo (data: URL), if they uploaded one. */
  readonly photo = signal<string | null>(null);
  /** What to show as the profile picture: their upload, else their Google photo. */
  readonly avatar = computed(() => this.photo() || this.user()?.photoUrl || null);
  /** False until the app knows whether someone is signed in. */
  readonly ready = signal(!this.cloud);
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
    if (this.demo) { this.startDemo(); return; }
    if (this.webCloud) {
      const config = webConfig()!;
      Auth = webAuth(config);
      Store = webStore(config);
    }

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

    this.watchChanges();
  }

  /** Back up likes, settings and the Library whenever they change (once the account's data is loaded). */
  private watchChanges(): void {
    effect(() => {
      this.library.liked();
      this.settings.snapshot();
      this.library.collections.playlists();
      this.library.collections.pins();
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
    if (this.demo) return this.demoSignUp(name, email, password);
    await Auth.createUserWithEmailAndPassword({ email: email.trim(), password });
    if (name.trim()) await Auth.updateProfile({ displayName: name.trim() }).catch(() => undefined);
    Auth.sendEmailVerification().catch(() => undefined);
    await this.refreshUser();
    this.welcome(true);
  }

  async logInWithEmail(email: string, password: string): Promise<void> {
    if (this.demo) return this.demoLogIn(email, password);
    await Auth.signInWithEmailAndPassword({ email: email.trim(), password });
    this.welcome(false);
  }

  resetPassword(email: string): Promise<void> {
    if (this.demo) return this.demoReset(email);
    return Auth.sendPasswordResetEmail({ email: email.trim() });
  }

  async continueWithGoogle(): Promise<void> {
    await Auth.signInWithGoogle();
    this.welcome(false);
  }

  /** Sends the OTP. Resolves when the text is on its way (or Android already verified the number). */
  sendOtp(phoneNumber: string, resend = false): Promise<void> {
    this.verificationId.set(null);
    if (this.demo) {
      this.demoPhone = phoneNumber;
      this.verificationId.set('demo');
      return new Promise(r => setTimeout(r, 600)); // feels like a text being sent
    }
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
    if (this.demo) return this.demoConfirmOtp(code);
    await Auth.confirmVerificationCode({ verificationId, verificationCode: code.trim() });
    this.verificationId.set(null);
    this.welcome(false);
  }

  // ---- signed in ----------------------------------------------------------

  async updateName(name: string): Promise<void> {
    if (this.demo) { this.demoEdit(u => ({ ...u, name: name.trim() || u.name })); return; }
    await Auth.updateProfile({ displayName: name.trim() || null });
    await this.refreshUser();
    this.scheduleSave(0);
  }

  async signOut(): Promise<void> {
    await this.saveNow();
    if (this.demo) { this.storage.remove(KEY_DEMO_SESSION); this.user.set(null); this.photo.set(null); }
    else await Auth.signOut();
    this.loadedUid = null;
    this.toast.show('Logged out. Your downloads stay on this phone.');
    if (this.required) this.screenOpen.set(true);
  }

  /** Deletes the account and its backed-up data. Likes and downloads stay on this phone. */
  async deleteAccount(): Promise<void> {
    const uid = this.user()?.uid;
    if (!uid) return;
    clearTimeout(this.saveTimer);
    if (this.demo) {
      this.writeDemoUsers(this.demoUsers().filter(u => u.uid !== uid));
      this.storage.remove(KEY_DEMO_SESSION);
      this.user.set(null);
    } else {
      await Store.deleteDocument({ reference: `users/${uid}` }).catch(() => undefined);
      await Auth.deleteUser();
    }
    this.loadedUid = null;
    this.toast.show('Account deleted');
    if (this.required) this.screenOpen.set(true);
  }

  // ---- private ------------------------------------------------------------

  private welcome(isNew: boolean): void {
    this.screenOpen.set(false);
    this.toast.show(isNew ? `Welcome to Cassette.fm, ${this.displayName()} ♥` : `Welcome back, ${this.displayName()}`, 2800);
  }

  // ---- profile photo ----------------------------------------------------------

  /** Uploads a profile photo: cropped to a square and shrunk to 192 px, then saved to the account. */
  async setPhoto(file: File): Promise<void> {
    const photo = await squareJpeg(file, 192);
    this.photo.set(photo);
    const uid = this.user()?.uid;
    if (uid) this.storage.set(`cfm.photo.${uid}`, photo);
    await this.saveNow();
  }

  async removePhoto(): Promise<void> {
    this.photo.set(null);
    const uid = this.user()?.uid;
    if (uid) this.storage.remove(`cfm.photo.${uid}`);
    await this.saveNow();
  }

  // ---- demo accounts (on this device) ---------------------------------------

  private demoPhone = '';

  private startDemo(): void {
    const uid = this.storage.get<string | null>(KEY_DEMO_SESSION, null);
    const user = uid ? this.demoUsers().find(u => u.uid === uid) : undefined;
    if (user) this.demoSignedIn(user);
    // First visit: show the welcome screen once (same as the real accounts).
    if (!user && (this.required || !this.storage.get(KEY_SKIPPED, false))) setTimeout(() => this.screenOpen.set(true), 400);
    this.watchChanges();
  }

  private demoUsers(): DemoUser[] {
    return this.storage.get<DemoUser[]>(KEY_DEMO_USERS, []);
  }

  private writeDemoUsers(users: DemoUser[]): void {
    this.storage.set(KEY_DEMO_USERS, users);
  }

  private demoEdit(change: (u: DemoUser) => DemoUser): void {
    const uid = this.user()?.uid;
    const users = this.demoUsers().map(u => (u.uid === uid ? change(u) : u));
    this.writeDemoUsers(users);
    const me = users.find(u => u.uid === uid);
    if (me) this.user.set(toAccountUser(me));
  }

  private async demoSignUp(name: string, email: string, password: string): Promise<void> {
    await pause();
    const mail = email.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(mail)) throw authError('auth/invalid-email');
    if (password.length < 6) throw authError('auth/weak-password');
    const users = this.demoUsers();
    if (users.some(u => u.email === mail)) throw authError('auth/email-already-in-use');
    const salt = Math.random().toString(36).slice(2);
    const user: DemoUser = {
      uid: 'demo-' + Date.now().toString(36), name: name.trim() || mail.split('@')[0], email: mail, phone: null,
      salt, hash: await hashPassword(password, salt), createdAt: Date.now(),
    };
    this.writeDemoUsers([...users, user]);
    this.demoSignedIn(user);
    this.welcome(true);
  }

  private async demoLogIn(email: string, password: string): Promise<void> {
    await pause();
    const mail = email.trim().toLowerCase();
    const user = this.demoUsers().find(u => u.email === mail);
    if (!user) throw authError('auth/user-not-found');
    if ((await hashPassword(password, user.salt)) !== user.hash) throw authError('auth/wrong-password');
    this.demoSignedIn(user);
    this.welcome(false);
  }

  private async demoReset(email: string): Promise<void> {
    await pause();
    const mail = email.trim().toLowerCase();
    if (!this.demoUsers().some(u => u.email === mail)) throw authError('auth/user-not-found');
    // Demo: no email is sent. The screen explains this.
  }

  private async demoConfirmOtp(code: string): Promise<void> {
    await pause();
    if (code.trim() !== DEMO_OTP) throw authError('auth/invalid-verification-code');
    const users = this.demoUsers();
    let user = users.find(u => u.phone === this.demoPhone);
    const isNew = !user;
    if (!user) {
      user = { uid: 'demo-' + Date.now().toString(36), name: 'Listener ' + this.demoPhone.slice(-4), email: null, phone: this.demoPhone, salt: '', hash: '', createdAt: Date.now() };
      this.writeDemoUsers([...users, user]);
    }
    this.verificationId.set(null);
    this.demoSignedIn(user);
    this.welcome(isNew);
  }

  private demoSignedIn(user: DemoUser): void {
    this.storage.set(KEY_DEMO_SESSION, user.uid);
    this.user.set(toAccountUser(user));
    this.photo.set(user.data?.photo ?? null);
    // Bring back this account's likes, settings and Library, merged with what's on the device.
    const cloud = user.data;
    if (cloud) this.applyCloud(cloud);
    this.loadedUid = user.uid;
    this.saveNow();
  }

  private applyCloud(cloud: CloudData): void {
    if (cloud.liked?.length) {
      const keys = new Set(cloud.liked.map(songKey));
      this.library.replaceLiked([...cloud.liked, ...this.library.liked().filter(s => !keys.has(songKey(s)))]);
    }
    if (cloud.settings) this.settings.restore(cloud.settings);
    if (cloud.library) this.library.collections.merge(cloud.library);
    if (cloud.photo && !this.photo()) {
      this.photo.set(cloud.photo);
      const uid = this.user()?.uid;
      if (uid) this.storage.set(`cfm.photo.${uid}`, cloud.photo);
    }
  }

  private async refreshUser(): Promise<void> {
    await Auth.reload().catch(() => undefined);
    const { user } = await Auth.getCurrentUser().catch(() => ({ user: null }));
    if (user) this.user.set({ ...user });
  }

  private onUser(user: AccountUser | null): void {
    const before = this.user()?.uid ?? null;
    this.user.set(user);
    if (user?.uid !== before) this.photo.set(user ? this.storage.get<string | null>(`cfm.photo.${user.uid}`, null) : null);
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
      // Keep both: the account's likes/playlists first, then anything only on this phone.
      if (cloud) this.applyCloud(cloud);
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
      library: this.library.collections.snapshot(),
      photo: this.photo(),
      updatedAt: Date.now(),
      ...(isNew ? { createdAt: Date.now() } : {}),
    };
    if (this.demo) {
      this.writeDemoUsers(this.demoUsers().map(u => (u.uid === uid ? { ...u, data } : u)));
      this.sync.set('synced');
      return;
    }
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
    [/unauthorized-domain/, "Sign-in isn't switched on for this website address yet (Firebase → Authentication → Settings → Authorized domains)."],
    [/popup-closed|cancelled-popup/, ''],
    [/cancel|12501|user canceled|closed/, ''],
  ];
  for (const [pattern, message] of rules) if (pattern.test(text)) return message;
  return 'Something went wrong. Please try again.';
}

function toAccountUser(u: DemoUser): AccountUser {
  return { uid: u.uid, displayName: u.name, email: u.email, phoneNumber: u.phone, photoUrl: null, emailVerified: true, providerData: [{ providerId: 'demo' }] };
}

function pause(ms = 450): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Crops an image file to the middle square and returns a small JPEG data: URL. */
function squareJpeg(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('not-an-image')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad-image')); };
    img.src = url;
  });
}

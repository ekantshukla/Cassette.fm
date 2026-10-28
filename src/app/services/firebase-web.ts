/*
 * Real accounts on the WEBSITE (email + password, Continue with Google), using the Firebase
 * JavaScript SDK. The Android app uses the native Firebase plugins instead (account.service.ts).
 *
 * This file gives the website the same small interface as those plugins, so AccountService
 * works the same way on both. Firebase is only downloaded when someone opens the sign-in screen
 * or is already signed in, so visitors who never log in don't pay for it.
 *
 * Needs FIREBASE_WEB_CONFIG in app-info.ts (filled in by the GitHub workflow, see ACCOUNTS.md).
 */
import type { AccountUser, FirebaseAuthenticationPlugin, FirebaseFirestorePlugin } from './account.service';

type Sdk = {
  auth: typeof import('firebase/auth');
  store: typeof import('firebase/firestore');
  authInstance: import('firebase/auth').Auth;
  db: import('firebase/firestore').Firestore;
};

let loading: Promise<Sdk> | null = null;

function load(config: object): Promise<Sdk> {
  loading ??= (async () => {
    const [{ initializeApp }, auth, store] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    const app = initializeApp(config);
    const authInstance = auth.getAuth(app);
    authInstance.useDeviceLanguage();
    await auth.setPersistence(authInstance, auth.browserLocalPersistence).catch(() => undefined);
    return { auth, store, authInstance, db: store.getFirestore(app) };
  })();
  return loading;
}

function toUser(u: import('firebase/auth').User | null): AccountUser | null {
  if (!u) return null;
  return {
    uid: u.uid, displayName: u.displayName, email: u.email, phoneNumber: u.phoneNumber, photoUrl: u.photoURL,
    emailVerified: u.emailVerified, providerData: u.providerData.map(p => ({ providerId: p.providerId })),
  };
}

function current(sdk: Sdk): import('firebase/auth').User {
  const u = sdk.authInstance.currentUser;
  if (!u) throw Object.assign(new Error('auth/no-current-user'), { code: 'auth/no-current-user' });
  return u;
}

export function webAuth(config: object): FirebaseAuthenticationPlugin {
  const sdk = () => load(config);
  const result = async (sdkp: Sdk) => ({ user: toUser(sdkp.authInstance.currentUser) });
  return {
    async getCurrentUser() {
      const s = await sdk();
      await s.authInstance.authStateReady();
      return result(s);
    },
    async createUserWithEmailAndPassword({ email, password }) {
      const s = await sdk();
      await s.auth.createUserWithEmailAndPassword(s.authInstance, email, password);
      return result(s);
    },
    async signInWithEmailAndPassword({ email, password }) {
      const s = await sdk();
      await s.auth.signInWithEmailAndPassword(s.authInstance, email, password);
      return result(s);
    },
    async sendPasswordResetEmail({ email }) {
      const s = await sdk();
      await s.auth.sendPasswordResetEmail(s.authInstance, email);
    },
    async sendEmailVerification() {
      const s = await sdk();
      await s.auth.sendEmailVerification(current(s));
    },
    async updateProfile(o) {
      const s = await sdk();
      await s.auth.updateProfile(current(s), { displayName: o.displayName ?? null });
    },
    async signInWithGoogle() {
      const s = await sdk();
      const provider = new s.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await s.auth.signInWithPopup(s.authInstance, provider);
      } catch (err) {
        // Phones sometimes block pop-ups: go to Google's page instead and come back signed in.
        if (/popup-blocked|operation-not-supported/.test(String((err as { code?: string }).code))) {
          await s.auth.signInWithRedirect(s.authInstance, provider);
        } else {
          throw err;
        }
      }
      return result(s);
    },
    async signInWithPhoneNumber() {
      throw Object.assign(new Error('auth/operation-not-allowed'), { code: 'auth/operation-not-allowed' });
    },
    async confirmVerificationCode() {
      throw Object.assign(new Error('auth/operation-not-allowed'), { code: 'auth/operation-not-allowed' });
    },
    async reload() {
      const s = await sdk();
      if (s.authInstance.currentUser) await s.authInstance.currentUser.reload();
    },
    async signOut() {
      const s = await sdk();
      await s.auth.signOut(s.authInstance);
    },
    async deleteUser() {
      const s = await sdk();
      await s.auth.deleteUser(current(s));
    },
    async useAppLanguage() { /* set when Firebase loads */ },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async addListener(event: string, handler: (data: any) => void) {
      if (event !== 'authStateChange') return { remove: async () => undefined };
      const s = await sdk();
      const off = s.auth.onAuthStateChanged(s.authInstance, u => handler({ user: toUser(u) }));
      return { remove: async () => off() };
    },
  } as FirebaseAuthenticationPlugin;
}

export function webStore(config: object): FirebaseFirestorePlugin {
  const sdk = () => load(config);
  return {
    async getDocument<T>({ reference }: { reference: string }) {
      const s = await sdk();
      const snap = await s.store.getDoc(s.store.doc(s.db, reference));
      return { snapshot: { data: snap.exists() ? (snap.data() as T) : null } };
    },
    async setDocument({ reference, data, merge }: { reference: string; data: object; merge?: boolean }) {
      const s = await sdk();
      await s.store.setDoc(s.store.doc(s.db, reference), data, { merge: !!merge });
    },
    async deleteDocument({ reference }: { reference: string }) {
      const s = await sdk();
      await s.store.deleteDoc(s.store.doc(s.db, reference));
    },
  };
}

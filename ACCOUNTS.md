# Accounts (sign up / log in) — Android app

Listeners can **sign up with email + password** or **Continue with Google**, like Spotify, in the
**Android app and on the website**. Their **liked songs, playlists, profile photo and settings are backed up**
to their account and come back on any phone or browser. Downloads stay on each device.

Until Firebase is set up, sign-up and log-in still work as **demo accounts** saved on the device only
(phone sign-in code `123456`). Once the steps below are done, the same screens become real accounts.

**Profile photo:** tap the circle in Settings (or *Upload photo*). It's cropped to a square, shrunk to about
15 KB and kept in the account's Firestore backup, so no paid Firebase Storage is needed. Google accounts
show their Google photo until the listener uploads their own. The photo and first name sit at the top right.

Accounts run on **Firebase** (Google). It's **free** for email and Google sign-in
(up to 50,000 monthly users) and for the small backups this app makes.

## What listeners see

- **First launch:** a welcome screen with *Sign up free*, *Continue with Google*, *Log in*, and *Not now*.
- **Sign up:** name, email, password (at least 6 characters). A confirmation email is sent.
- **Log in:** email + password, with *Forgot password?* (sends a reset link).
- **Settings ⚙:** their name (editable), email, "backed up" status, *Log out*, *Delete account*.
  When logged in, the ⚙ button in the header shows their initials.

## One-time setup (about 15 minutes)

1. Go to <https://console.firebase.google.com> → **Create a project** → name it `Cassette-fm`
   (Google Analytics: off is fine). Stay on the free **Spark** plan.
2. **Build → Authentication → Get started → Sign-in method**, then turn on:
   - **Email/Password** (just the first switch)
   - **Google** (choose your support email → Save)
3. **Build → Firestore Database → Create database** → *Production mode* → location **asia-south1 (Mumbai)**.
   Then the **Rules** tab: paste the contents of `firestore.rules` from this repo → **Publish**.
4. **Project settings ⚙ → Your apps → Android icon** (add an Android app):
   - Package name: `fm.cassette.app`
   - App nickname: Cassette.fm
   - Debug signing certificate SHA-1: `24:D6:89:81:63:CD:83:EF:7F:FC:EA:82:AF:C4:C2:49:F9:31:98:7B`
   - Register app → **Download google-services.json** → you can skip the remaining steps.
5. Back in **Project settings → Your apps → Cassette.fm**, click **Add fingerprint** and also add the SHA-256:
   `45:1A:23:F5:4E:5A:9A:C1:3E:E6:91:1E:9D:0F:E6:F4:47:43:6D:20:6B:F7:3D:9B:B7:EF:27:B2:8F:B1:A3:DE`
   (Both fingerprints belong to your signing key, `cassette-release.jks`. Google sign-in only works with them.)
6. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `GOOGLE_SERVICES_JSON`
   - Value: open `google-services.json` in Notepad, copy **everything**, paste.
7. Run **Actions → Build Android app** again. The new APK has accounts.

> Order matters: turn on Google sign-in (step 2) **before** downloading `google-services.json` (step 4).
> If you turned it on later, download the file again and update the secret.

## Real accounts on the website too (5 more minutes)

Do the steps above first (same Firebase project), then:

1. Firebase → **Project settings ⚙ → Your apps → Add app → Web (`</>`)** → nickname `Cassette.fm website` →
   **Register app**. Firebase shows a `firebaseConfig = { apiKey: …, authDomain: …, projectId: …, appId: … }` block.
2. Turn that block into JSON (keys and values in double quotes), for example:
   `{"apiKey":"AIza…","authDomain":"cassette-fm.firebaseapp.com","projectId":"cassette-fm","storageBucket":"cassette-fm.firebasestorage.app","messagingSenderId":"123…","appId":"1:123…:web:abc…"}`
3. GitHub repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable** →
   name `FIREBASE_WEB_CONFIG`, value: the JSON. (These values are public by design; Firestore rules protect the data.)
4. Firebase → **Authentication → Settings → Authorized domains → Add domain** → `<your-github-username>.github.io`.
5. Run **Actions → Deploy to GitHub Pages**. The website now has real email + Google sign-in.

## Switches (in `src/app/data/app-info.ts`)

| | |
|---|---|
| `REQUIRE_SIGN_IN = false` | Set to `true` to make an account required (no *Not now*), like Spotify. |
| `PHONE_SIGN_IN = false` | Phone number + OTP sign-in is built but switched off: Firebase charges for each OTP text (about $0.07 to India after 10 free a day) and needs a billing card (Blaze plan). To use it: switch to Blaze, enable **Phone** in Authentication, set this to `true`, and add `'phone'` to `providers` in `capacitor.config.ts`. |

## Good to know

- Passwords are handled entirely by Firebase. The app never stores them.
- **Delete account** removes the account and its backup. If Firebase says the log-in is too old,
  the app asks the listener to log out and in again first (a Firebase safety rule).
- Building without the `GOOGLE_SERVICES_JSON` secret still works: the app just has no accounts.
- You can see users in Firebase → Authentication → Users, and their backups in Firestore → `users`.

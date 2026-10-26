import type { CapacitorConfig } from '@capacitor/cli';

/** Settings for the Android app (built with Capacitor from the same Angular code as the website). */
const config: CapacitorConfig = {
  appId: 'fm.cassette.app',
  appName: 'Cassette.fm',
  webDir: 'dist/oldskool-fm/browser',
  backgroundColor: '#140c26',
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#140c26', showSpinner: false },
    // Accounts: sign-in happens in Android itself, then the web code reads the user.
    FirebaseAuthentication: { skipNativeAuth: false, providers: ['google.com'] },
  },
};

export default config;

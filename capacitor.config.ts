import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.benmccloskey.JapaneseReadingCompanion',
  appName: 'Japanese Reading Companion',
  webDir: 'out/web',
  // App background color — matches the dark sumi tone used by the renderer.
  // Painted into the iOS view so the safe-area regions (notch, home
  // indicator) blend with the app instead of showing as black bars.
  backgroundColor: '#0b0b0d',
  ios: {
    // Let the WKWebView span the full screen; CSS handles the safe-area
    // padding via env(safe-area-inset-*). This is what makes the tab bar
    // sit flush against the home indicator and the page content tuck under
    // the notch correctly.
    contentInset: 'never',
    backgroundColor: '#0b0b0d',
    loggingBehavior: 'debug',
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
    },
  },
};

export default config;

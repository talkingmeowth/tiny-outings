import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

const isNativeApp = Capacitor.isNativePlatform();

// PKCE saves a short-lived code verifier before the browser opens. Android can
// recreate the WebView after the OAuth deep link, so browser localStorage is
// not dependable enough for that handoff. Preferences is native persistent
// storage and has the async StorageAdapter shape supported by Supabase Auth.
const authStorage = {
  async getItem(key) {
    if (isNativeApp) return (await Preferences.get({ key })).value;
    return window.localStorage.getItem(key);
  },
  async setItem(key, value) {
    if (isNativeApp) {
      await Preferences.set({ key, value });
      return;
    }
    window.localStorage.setItem(key, value);
  },
  async removeItem(key) {
    if (isNativeApp) {
      await Preferences.remove({ key });
      return;
    }
    window.localStorage.removeItem(key);
  },
};

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: authStorage,
      flowType: 'pkce',
      // Native redirects are handed to App.appUrlOpen below, rather than the
      // WebView URL, so they must be exchanged explicitly.
      detectSessionInUrl: !isNativeApp,
    },
  })
  : null;

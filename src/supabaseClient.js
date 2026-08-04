import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

const isNativeApp = Capacitor.isNativePlatform();
const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : null;
const authStorageKey = projectRef ? `sb-${projectRef}-auth-token` : null;
const codeVerifierKey = authStorageKey ? `${authStorageKey}-code-verifier` : null;
const nativeVerifierBackupKey = 'tiny-outings:oauth-code-verifier';

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

export async function clearNativePkceAttempt() {
  if (!isNativeApp || !codeVerifierKey) return;
  await Promise.all([
    authStorage.removeItem(codeVerifierKey),
    Preferences.remove({ key: nativeVerifierBackupKey }),
  ]);
}

// Keep a second native copy of the short-lived verifier before Chrome opens.
// Some Android devices recreate the WebView while handling the app link, which
// otherwise leaves Supabase Auth unable to read its primary verifier key.
export async function preserveNativePkceVerifier() {
  if (!isNativeApp || !codeVerifierKey) return true;
  const verifier = await authStorage.getItem(codeVerifierKey);
  if (!verifier) return false;
  await Preferences.set({ key: nativeVerifierBackupKey, value: verifier });
  return true;
}

export async function completeNativePkceSignIn(callbackUrl) {
  if (!supabase || !isNativeApp || !codeVerifierKey) {
    return { error: new Error('Google sign-in is not available in this build.') };
  }

  const authCode = new URL(callbackUrl).searchParams.get('code');
  const backupVerifier = (await Preferences.get({ key: nativeVerifierBackupKey })).value;
  const primaryVerifier = await authStorage.getItem(codeVerifierKey);
  // The backup is captured immediately after this attempt creates its OAuth
  // URL. Prefer it over the primary key, which can be stale after an Android
  // activity recreation or a previous cancelled attempt.
  const verifier = backupVerifier || primaryVerifier;

  if (!authCode || !verifier) {
    return { error: new Error('The sign-in response was incomplete. Please try again.') };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ auth_code: authCode, code_verifier: verifier.split('/')[0] }),
    });
    const body = await response.json();
    if (!response.ok) return { error: new Error(body.error_description || body.msg || 'Google sign-in could not finish.') };

    const { error } = await supabase.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    if (error) return { error };

    await authStorage.removeItem(codeVerifierKey);
    await Preferences.remove({ key: nativeVerifierBackupKey });
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error('Google sign-in could not finish.') };
  }
}

import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
const isNativeApp = Capacitor.isNativePlatform();

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Android receives access tokens via the application callback, avoiding
      // the fragile PKCE verifier handoff between Chrome and the WebView.
      flowType: isNativeApp ? 'implicit' : 'pkce',
      detectSessionInUrl: !isNativeApp,
    },
  })
  : null;

export async function completeNativeGoogleSignIn(callbackUrl) {
  if (!supabase) return { error: new Error('Sign-in is not configured in this build.') };

  const url = new URL(callbackUrl);
  const values = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.search);
  const providerError = values.get('error_description') || values.get('error');
  if (providerError) return { error: new Error(providerError) };

  const accessToken = values.get('access_token');
  const refreshToken = values.get('refresh_token');
  if (!accessToken || !refreshToken) {
    return { error: new Error('Google did not return a complete sign-in response. Please try again.') };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return { data, error };
}

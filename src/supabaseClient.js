import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Production Android authentication uses the native Google token flow.
      // Accept an auth callback only in local development so end-to-end QA can
      // use disposable Supabase users without touching a real Google account.
      detectSessionInUrl: import.meta.env.DEV,
    },
  })
  : null;

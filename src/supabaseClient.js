import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // The app is client-only. Implicit flow avoids a PKCE verifier being lost
      // when Android sends the browser-based fallback back into the installed app.
      flowType: 'implicit',
      detectSessionInUrl: true,
    },
  })
  : null;

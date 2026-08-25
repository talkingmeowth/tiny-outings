import { createClient } from '@supabase/supabase-js';

const fallbackProjectUrl = 'https://kgvqbokhuqaonghcukel.supabase.co';

async function loadPublicConfig() {
  const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
  const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (configuredUrl && configuredAnonKey) return { url: configuredUrl, anonKey: configuredAnonKey };
  try {
    const response = await fetch(`${fallbackProjectUrl}/functions/v1/image-review-config`);
    if (!response.ok) return null;
    const value = await response.json();
    return value?.url && value?.anonKey ? value : null;
  } catch {
    return null;
  }
}

const publicConfig = await loadPublicConfig();
const supabaseUrl = publicConfig?.url;
const supabaseAnonKey = publicConfig?.anonKey;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  : null;

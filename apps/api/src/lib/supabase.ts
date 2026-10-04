import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_LOCAL_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_LOCAL_PUBLISHABLE_KEY are required'
  );
}

export const supabaseAuth = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export function createUserSupabaseClient(accessToken: string) {
  // Checked again here so TypeScript knows both values exist.
  if (!url || !key) {
    throw new Error('Supabase environment variables are missing');
  }

  return createClient(url, key, {
    accessToken: async () => accessToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
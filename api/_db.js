import { createClient } from '@supabase/supabase-js';

let supabase;

export function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key || key.includes('PEGA_AQUI')) {
      throw new Error(
        'Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el archivo .env (Project Settings -> API en Supabase).'
      );
    }

    supabase = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return supabase;
}

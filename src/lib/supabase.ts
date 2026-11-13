import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

/** Vrai quand les variables d'environnement Supabase sont configurées. */
export const supabaseConfigured = Boolean(url && anon);

let client: SupabaseClient | null = null;

/** Client Supabase (clé anonyme publique, protégée par les règles RLS côté serveur). */
export function getSupabase(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Supabase non configuré (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY).');
  if (!client) client = createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export type Role = 'membre' | 'bureau' | 'admin';

export interface Profile {
  id: string;
  prenom: string;
  nom: string;
  classe: string | null;
  role: Role;
  newsletter: boolean;
  created_at: string;
}

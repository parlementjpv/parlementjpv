import { getSupabase, supabaseConfigured } from './supabase';
/** Appels aux fonctions serveur (Supabase Edge Functions) — jamais de clé secrète côté navigateur. */
const FN_BASE = `${(import.meta.env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1`;
/** Transforme '/api/xxx' en URL complète de la fonction serveur. */
export const api = (path: string) => `${FN_BASE}/${path.replace(/^\/api\//, '')}`;

export async function subscribeNewsletter(email: string, turnstileToken = ''): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(api('/api/newsletter-subscribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || 'Une erreur est survenue, réessaie plus tard.' };
    return { ok: true, message: data.message || 'Presque fini : clique sur le lien reçu par email pour confirmer.' };
  } catch {
    return { ok: false, message: 'Impossible de joindre le serveur.' };
  }
}

export async function postJSON<T = any>(path: string, body: unknown, accessToken?: string): Promise<{ ok: boolean; data: T; error?: string }> {
  try {
    if (accessToken && supabaseConfigured) {
      // Le jeton capturé au chargement de la page expire au bout d'une heure : on prend toujours le plus récent.
      const { data } = await getSupabase().auth.getSession();
      if (data.session?.access_token) accessToken = data.session.access_token;
    }
    const res = await fetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && accessToken) {
      const { expireSession } = await import('./auth');
      await expireSession();
      return { ok: false, data, error: 'Ta connexion a expiré : reconnecte-toi.' };
    }
    return { ok: res.ok, data, error: res.ok ? undefined : data.error || `Erreur ${res.status}` };
  } catch {
    return { ok: false, data: {} as T, error: 'Impossible de joindre le serveur.' };
  }
}

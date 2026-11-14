import { u } from './url';
import { getSupabase, supabaseConfigured, type Profile } from './supabase';

/** Met à jour les liens Connexion / Mon espace du header selon la session. */
export async function refreshAuthUI() {
  if (!supabaseConfigured) return;
  try {
    const { data } = await getSupabase().auth.getSession();
    const logged = Boolean(data.session);
    if (logged) { try { localStorage.setItem('jpv_compte', '1'); } catch {} document.documentElement.classList.add('membre'); }
    document.querySelectorAll<HTMLElement>('[data-auth="in"]').forEach((el) => el.classList.toggle('hidden', !logged));
    document.querySelectorAll<HTMLElement>('[data-auth="out"]').forEach((el) => el.classList.toggle('hidden', logged));
  } catch {
    /* silencieux : le site reste utilisable sans Supabase */
  }
}

/** Session courante, ou null. */
export async function getSession() {
  if (!supabaseConfigured) return null;
  const { data } = await getSupabase().auth.getSession();
  return data.session;
}

/** Redirige vers /connexion si l'utilisateur n'est pas connecté. Retourne la session sinon. */
export async function requireSession(next = location.pathname) {
  const session = await getSession();
  if (!session) {
    location.href = u(`/connexion?next=${encodeURIComponent(next)}`);
    return null;
  }
  return session;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await getSupabase().from('profiles').select('*').eq('id', userId).maybeSingle();
  return (data as Profile) ?? null;
}

export async function signOut() {
  await getSupabase().auth.signOut();
  location.href = u('/');
}

/** Messages d'erreur Supabase traduits. */
export function frError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'Email ou mot de passe incorrect.';
  if (m.includes('banned')) return 'Ce compte a été suspendu par le bureau du Parlement JPV. Écris-nous via la page Contact si tu penses que c\'est une erreur.';
  if (m.includes('email not confirmed')) return 'Confirme d’abord ton adresse email (vérifie ta boîte de réception).';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Un compte existe déjà avec cet email.';
  if (m.includes('password should be')) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (m.includes('rate limit')) return 'Trop de tentatives, réessaie dans quelques minutes.';
  if (m.includes('non configuré')) return 'Le serveur d’inscription n’est pas encore configuré.';
  return message;
}

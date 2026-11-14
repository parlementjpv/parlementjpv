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
  // Vérifie auprès du serveur que la connexion est toujours valable (session révoquée, compte banni ou supprimé…)
  const { error } = await getSupabase().auth.getUser();
  if (error) {
    await expireSession(next);
    return null;
  }
  return session;
}

/** Connexion plus reconnue par le serveur : on nettoie et on renvoie vers la page de connexion. */
export async function expireSession(next = location.pathname + location.search) {
  try { await getSupabase().auth.signOut({ scope: 'local' }); } catch {}
  location.href = u(`/connexion?expire=1&next=${encodeURIComponent(next)}`);
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

/** Bouton « Renvoyer l'email de confirmation », avec délai d'attente de 60 s entre deux envois. */
export function resendBox(email: string | (() => string), label = "Je n'ai pas reçu l'email : le renvoyer") {
  const box = document.createElement('div');
  box.className = 'resend';
  box.innerHTML = `<button class="btn btn-outline btn-sm" type="button">${label}</button><p class="small muted resend-msg" style="margin:8px 0 0;"></p>`;
  const btn = box.querySelector('button')!, out = box.querySelector('.resend-msg')!;
  let timer: number | undefined;
  const wait = (s: number) => {
    btn.disabled = true; clearInterval(timer);
    const tick = () => { btn.textContent = `Renvoyer à nouveau (${s} s)`; if (s-- <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "Renvoyer l'email de confirmation"; } };
    tick(); timer = window.setInterval(tick, 1000);
  };
  btn.addEventListener('click', async () => {
    const mail = (typeof email === 'function' ? email() : email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) { out.textContent = "Indique d'abord ton adresse email dans le champ ci-dessus."; return; }
    btn.disabled = true; out.textContent = 'Envoi…';
    const { error } = await getSupabase().auth.resend({ type: 'signup', email: mail, options: { emailRedirectTo: `${location.origin}${u('/compte')}?bienvenue=1` } });
    if (error) {
      const m = error.message.toLowerCase();
      const s = Number((m.match(/after (\d+) seconds?/) || [])[1]);
      if (s) { out.textContent = `Un email vient déjà de partir. Tu pourras en redemander un dans ${s} secondes.`; wait(s); return; }
      out.textContent = m.includes('rate limit') ? "Trop de demandes pour l'instant : réessaie dans quelques minutes." : "L'email n'a pas pu être renvoyé. Si ton compte est déjà confirmé, connecte-toi simplement.";
      btn.disabled = false; return;
    }
    out.innerHTML = `Email renvoyé à <strong>${mail.replace(/[<>&"]/g, '')}</strong>. Regarde aussi dans les spams et l'onglet « Promotions ». Le lien est valable 24 h.`;
    wait(60);
  });
  return box;
}

/** Pages réservées aux membres : session valide + compte non suspendu. */
export async function requireMembre() {
  const session = await requireSession();
  if (!session) return null;
  const profile = await getProfile(session.user.id);
  if (!profile || (profile as any).banni) { location.href = u('/compte'); return null; }
  return { session, profile };
}

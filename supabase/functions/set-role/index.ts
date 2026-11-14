import { admin, json, userFromRequest, cors, readJson } from '../_shared/lib.ts';

const POSTES = ['Président·e', 'Vice-président·e', 'Secrétaire général·e', 'Trésorier·e', 'Responsable Débat', 'Responsable Éloquence', 'Responsable Conférences', 'Responsable Visites', 'Responsable Communication'];

/** Rôle d'accès (membre / bureau / admin) et poste au bureau (Président·e…). Réservé aux admins. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = await readJson(req); if (!b?.userId) return json(req, 400, { error: 'Requête invalide' });
  const db = admin();
  const { data: cible } = await db.from('profiles').select('role, banni').eq('id', b.userId).maybeSingle();
  if (!cible) return json(req, 404, { error: 'Compte introuvable.' });

  if ('poste' in b) {
    const poste = b.poste || null;
    if (poste && !POSTES.includes(poste)) return json(req, 400, { error: 'Poste invalide.' });
    if (poste && cible.banni) return json(req, 400, { error: 'Un compte suspendu ne peut pas recevoir de poste.' });
    let ancien: string | null = null;
    if (poste) {
      // Un poste n'a qu'un titulaire : l'ancien le perd automatiquement
      const { data: prev } = await db.from('profiles').select('id, prenom, nom').eq('poste', poste).neq('id', b.userId).maybeSingle();
      if (prev) { ancien = `${prev.prenom} ${prev.nom}`; await db.from('profiles').update({ poste: null }).eq('id', prev.id); }
    }
    // Recevoir un poste donne accès à l'espace bureau
    const maj: Record<string, unknown> = { poste };
    if (poste && cible.role === 'membre') maj.role = 'bureau';
    const { error } = await db.from('profiles').update(maj).eq('id', b.userId);
    if (error) return json(req, 500, { error: error.message });
    return json(req, 200, { ok: true, ancien, role: maj.role ?? cible.role });
  }

  if (!['membre', 'bureau', 'admin'].includes(b.role)) return json(req, 400, { error: 'Rôle invalide.' });
  if (b.userId === me.user.id && b.role !== 'admin') return json(req, 400, { error: 'Tu ne peux pas retirer ton propre rôle admin.' });
  const { error } = await db.from('profiles').update({ role: b.role, ...(b.role === 'membre' ? { poste: null } : {}) }).eq('id', b.userId);
  if (error) return json(req, 500, { error: error.message });
  return json(req, 200, { ok: true });
});

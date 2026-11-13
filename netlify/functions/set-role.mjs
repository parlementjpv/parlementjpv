import { admin, json, userFromRequest } from './_lib.mjs';

/** Changement de rôle : réservé aux admins (vérifié côté serveur). */
export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me || me.profile?.role !== 'admin') return json(403, { error: 'Réservé aux administrateurs.' });
  let b; try { b = await req.json(); } catch { return json(400, { error: 'Requête invalide' }); }
  if (!['membre', 'bureau', 'admin'].includes(b.role)) return json(400, { error: 'Rôle invalide.' });
  if (b.userId === me.user.id && b.role !== 'admin') return json(400, { error: 'Tu ne peux pas retirer ton propre rôle admin.' });
  const { error } = await admin().from('profiles').update({ role: b.role }).eq('id', b.userId);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
};

export const config = { path: '/api/set-role' };

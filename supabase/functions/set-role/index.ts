import { admin, json, userFromRequest, cors, readJson } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = await readJson(req); if (!b) return json(req, 400, { error: 'Requête invalide' });
  if (!['membre', 'bureau', 'admin'].includes(b.role)) return json(req, 400, { error: 'Rôle invalide.' });
  if (b.userId === me.user.id && b.role !== 'admin') return json(req, 400, { error: 'Tu ne peux pas retirer ton propre rôle admin.' });
  const { error } = await admin().from('profiles').update({ role: b.role }).eq('id', b.userId);
  if (error) return json(req, 500, { error: error.message });
  return json(req, 200, { ok: true });
});

import { json, cors, userFromRequest } from '../_shared/lib.ts';
import { pushUtilisateurs } from '../_shared/push.ts';

// Notification de test envoyée à soi-même (bouton dans Mon espace)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  const r = await pushUtilisateurs([me.user.id], { titre: 'Les notifications marchent', texte: `${me.profile?.prenom || 'Salut'}, tu recevras ici les nouvelles séances, les rappels et les votes.`, tag: 'test' });
  return json(req, 200, { ok: true, ...r });
});

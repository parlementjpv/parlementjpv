import { admin, json, userFromRequest } from './_lib.mjs';

/** Suppression RGPD du compte : auth.users (cascade sur profiles, inscriptions) + anonymisation des candidatures. */
export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(401, { error: 'Connexion requise.' });
  const db = admin();
  await db.from('candidatures').delete().eq('user_id', me.user.id);
  const { error } = await db.auth.admin.deleteUser(me.user.id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
};

export const config = { path: '/api/account-delete' };

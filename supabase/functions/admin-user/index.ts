import { admin, json, userFromRequest, cors, readJson } from '../_shared/lib.ts';

/** Bannir / débannir / supprimer un compte. Réservé aux admins, jamais sur soi-même. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me || me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = await readJson(req); if (!b) return json(req, 400, { error: 'Requête invalide' });
  if (!['ban', 'unban', 'delete'].includes(b.action)) return json(req, 400, { error: 'Action invalide.' });
  if (b.userId === me.user.id) return json(req, 400, { error: 'Tu ne peux pas faire ça sur ton propre compte.' });

  const db = admin();
  if (b.action === 'delete') {
    // Suppression définitive : données liées au compte, puis le compte (le profil suit en cascade)
    await db.from('candidatures').delete().eq('user_id', b.userId);
    await db.from('event_signups').delete().eq('user_id', b.userId);
    await db.from('adhesions').delete().eq('user_id', b.userId);
    const { error } = await db.auth.admin.deleteUser(b.userId);
    if (error) return json(req, 500, { error: error.message });
    return json(req, 200, { ok: true, deleted: true });
  }
  const ban = b.action === 'ban';
  const { error } = await db.auth.admin.updateUserById(b.userId, { ban_duration: ban ? '876000h' : 'none' });
  if (error) return json(req, 500, { error: error.message });
  await db.from('profiles').update({ banni: ban, ...(ban ? { role: 'membre' } : {}) }).eq('id', b.userId);
  return json(req, 200, { ok: true, banni: ban });
});

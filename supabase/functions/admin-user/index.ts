import { admin, json, userFromRequest, cors, readJson, journal } from '../_shared/lib.ts';

/** Bannir / débannir / supprimer un compte. Réservé aux admins, jamais sur soi-même. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = await readJson(req); if (!b) return json(req, 400, { error: 'Requête invalide' });
  if (!['ban', 'unban', 'delete'].includes(b.action)) return json(req, 400, { error: 'Action invalide.' });
  if (b.userId === me.user.id) return json(req, 400, { error: 'Tu ne peux pas faire ça sur ton propre compte.' });

  const db = admin();
  const { data: cible } = await db.from('profiles').select('prenom, nom').eq('id', b.userId).maybeSingle();
  const qui = cible ? `${cible.prenom} ${cible.nom}` : 'un compte';
  if (b.action === 'delete') {
    // Suppression définitive : données liées au compte, puis le compte (le profil suit en cascade)
    await db.from('candidatures').delete().eq('user_id', b.userId);
    await db.from('event_signups').delete().eq('user_id', b.userId);
    await db.from('adhesions').delete().eq('user_id', b.userId);
    const { data: u } = await db.auth.admin.getUserById(b.userId);
    if (u?.user?.email) await db.from('adhesions').delete().ilike('email', u.user.email);
    const { error } = await db.auth.admin.deleteUser(b.userId);
    if (error) return json(req, 500, { error: error.message });
    await journal(me.user.id, 'Membres', `a supprimé le compte de ${qui}`);
    return json(req, 200, { ok: true, deleted: true });
  }
  const ban = b.action === 'ban';
  const { error } = await db.auth.admin.updateUserById(b.userId, { ban_duration: ban ? '876000h' : 'none' });
  if (error) return json(req, 500, { error: error.message });
  await db.from('profiles').update({ banni: ban, ...(ban ? { role: 'membre', poste: null } : { absences_depuis: new Date().toISOString() }) }).eq('id', b.userId);
  await journal(me.user.id, 'Membres', ban ? `a banni ${qui}` : `a débanni ${qui}`);
  return json(req, 200, { ok: true, banni: ban });
});

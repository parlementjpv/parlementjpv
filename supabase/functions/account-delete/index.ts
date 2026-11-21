import { admin, json, userFromRequest, cors } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Connexion requise.' });
  const db = admin();
  // Tout ce qui est rattaché au compte part avec lui : adhésion (aussi par email), inscriptions, candidatures, newsletter
  await db.from('candidatures').delete().eq('user_id', me.user.id);
  await db.from('event_signups').delete().eq('user_id', me.user.id);
  await db.from('adhesions').delete().eq('user_id', me.user.id);
  if (me.user.email) {
    await db.from('adhesions').delete().ilike('email', me.user.email);
    await db.from('newsletter_subscribers').delete().ilike('email', me.user.email);
  }
  const { error } = await db.auth.admin.deleteUser(me.user.id);
  if (error) return json(req, 500, { error: error.message });
  return json(req, 200, { ok: true });
});

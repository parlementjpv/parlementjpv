import { admin, sendMail, json, esc, layout, FROM, cors, readJson, userFromRequest } from '../_shared/lib.ts';

// Un membre écrit à un membre du bureau : l'email part du Parlement, la réponse revient directement au membre (Reply-To).
// L'adresse du membre du bureau n'est jamais montrée à l'expéditeur.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me?.user.email) return json(req, 401, { error: 'Ta session a expiré.' });
  if (me.profile?.banni) return json(req, 403, { error: 'Compte suspendu.' });
  const b = await readJson(req);
  const sujet = String(b?.sujet || '').trim().slice(0, 120), message = String(b?.message || '').trim().slice(0, 3000);
  if (!sujet || message.length < 5) return json(req, 400, { error: 'Indique un objet et un message.' });
  const db = admin();
  const { count } = await db.from('contact_bureau_log').select('*', { count: 'exact', head: true }).eq('user_id', me.user.id).gte('at', new Date(Date.now() - 86400000).toISOString());
  if ((count || 0) >= 5) return json(req, 429, { error: 'Tu as déjà envoyé 5 messages aujourd\'hui. Réessaie demain.' });
  const { data: dest } = await db.from('profiles').select('id, prenom, poste, role, banni').eq('id', b?.destinataire).maybeSingle();
  if (!dest || !['bureau', 'admin'].includes(dest.role) || dest.banni) return json(req, 400, { error: 'Destinataire invalide.' });
  const { data: a } = await db.from('adhesions').select('email').eq('user_id', dest.id).maybeSingle();
  let to = a?.email; if (!to) { const { data: u } = await db.auth.admin.getUserById(dest.id); to = u?.user?.email; }
  if (!to) return json(req, 500, { error: 'Envoi impossible.' });
  const exp = `${me.profile?.prenom || ''} ${me.profile?.nom || ''}`.trim();
  await sendMail({ from: FROM, to, replyTo: me.user.email, subject: `[Parlement JPV] ${sujet}`, html: layout({ title: `Message de ${exp}`, body:
    `<p style="color:#555;font-size:14px;">${esc(exp)}${me.profile?.classe ? ` (${esc(me.profile.classe)})` : ''} t'écrit${dest.poste ? ` en tant que ${esc(dest.poste)}` : ''} depuis son espace membre.</p>
     <p><strong>${esc(sujet)}</strong></p><div style="white-space:pre-wrap;">${esc(message)}</div>
     <p style="color:#555;font-size:14px;margin-top:24px;">Pour lui répondre, réponds simplement à cet email : ta réponse arrivera directement dans sa boîte.</p>` }) });
  await db.from('contact_bureau_log').insert({ user_id: me.user.id });
  return json(req, 200, { ok: true });
});

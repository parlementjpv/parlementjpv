import { admin, sendMail, json, userFromRequest, esc, layout, BUREAU_EMAIL, cors, readJson } from '../_shared/lib.ts';

const MAX = 100; // destinataires par envoi (Gmail : ~500 emails par jour au total)

/** Le bureau écrit à des membres choisis (adhésions). Un email individuel par destinataire. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Accès réservé au bureau.' });
  const b = await readJson(req); if (!b) return json(req, 400, { error: 'Requête invalide' });
  const subject = String(b.subject || '').trim().slice(0, 200);
  const body = String(b.body || '').trim().slice(0, 10000);
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string') : [];
  if (!subject || !body) return json(req, 400, { error: 'Objet et message obligatoires.' });
  if (!ids.length) return json(req, 400, { error: 'Choisis au moins un destinataire.' });
  if (ids.length > MAX) return json(req, 400, { error: `${MAX} destinataires maximum par envoi.` });

  const db = admin();
  const { data: people } = await db.from('adhesions').select('id, prenom, email').in('id', ids);
  if (!people?.length) return json(req, 400, { error: 'Destinataires introuvables.' });

  const from = `${me.profile?.prenom || ''} ${me.profile?.nom || ''}`.trim() || 'Le bureau';
  const role = me.profile?.role === 'admin' ? 'administration' : 'bureau';
  const html = (prenom: string) => layout({
    title: subject,
    body: `<p>Bonjour ${esc(prenom)},</p><div style="white-space:pre-wrap;">${esc(body)}</div><p style="margin-top:24px;color:#5d6477;font-size:14px;">${esc(from)} — ${role} du Parlement JPV<br>Pour répondre, réponds simplement à cet email.</p>`,
  });

  let sent = 0; const failed: string[] = [];
  for (const p of people) {
    try { await sendMail({ to: p.email, subject, html: html(p.prenom), text: `Bonjour ${p.prenom},\n\n${body}\n\n${from} — ${role} du Parlement JPV`, replyTo: BUREAU_EMAIL }); sent++; }
    catch (e) { console.error('envoi', p.email, e); failed.push(p.email); }
  }
  await db.from('member_messages').insert({ subject, body, recipients: people.map((p) => p.email), sent_count: sent, sender_id: me.user.id, sender_name: from });
  if (!sent) return json(req, 500, { error: "Aucun email n'a pu partir." });
  return json(req, 200, { sent, failed });
});

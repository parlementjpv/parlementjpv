import { admin, resend, json, userFromRequest, layout, SITE, FROM } from './_lib.mjs';

/** Envoi d'une newsletter à tous les abonnés confirmés. Réservé au bureau (JWT vérifié). */
export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me || !['bureau', 'admin'].includes(me.profile?.role)) return json(403, { error: 'Accès réservé au bureau.' });
  let body; try { body = await req.json(); } catch { return json(400, { error: 'Requête invalide' }); }
  const { newsletterId, test } = body;
  const db = admin();
  const { data: nl } = await db.from('newsletters').select('*').eq('id', newsletterId).maybeSingle();
  if (!nl) return json(404, { error: 'Newsletter introuvable.' });
  if (nl.sent_at && !test) return json(400, { error: 'Cette newsletter a déjà été envoyée.' });

  let recipients;
  if (test) recipients = [{ email: me.user.email, token: 'test' }];
  else {
    const { data } = await db.from('newsletter_subscribers').select('email, token').eq('confirmed', true).is('unsubscribed_at', null);
    recipients = data || [];
  }
  if (recipients.length === 0) return json(400, { error: 'Aucun abonné confirmé.' });

  const r = resend();
  const batches = [];
  for (let i = 0; i < recipients.length; i += 100) {
    batches.push(recipients.slice(i, i + 100).map((s) => ({
      from: FROM, to: s.email, subject: test ? `[TEST] ${nl.subject}` : nl.subject,
      html: layout({ title: nl.subject, body: nl.body_html, unsubscribeUrl: `${SITE}/api/newsletter-unsubscribe?token=${s.token}` }),
      text: nl.body_text || nl.subject,
      headers: { 'List-Unsubscribe': `<${SITE}/api/newsletter-unsubscribe?token=${s.token}>` },
    })));
  }
  let sent = 0;
  for (const batch of batches) {
    const { error } = await r.batch.send(batch);
    if (error) { console.error(error); return json(500, { error: `Erreur d'envoi après ${sent} emails : ${error.message}` }); }
    sent += batch.length;
  }
  if (!test) await db.from('newsletters').update({ sent_at: new Date().toISOString(), recipients: sent }).eq('id', nl.id);
  return json(200, { sent, test: Boolean(test) });
};

export const config = { path: '/api/newsletter-send' };

import { admin, sendMail, json, userFromRequest, layout, FROM, cors, readJson } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me || !['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Accès réservé au bureau.' });
  const body = await readJson(req); if (!body) return json(req, 400, { error: 'Requête invalide' });
  const { newsletterId, test } = body;
  const db = admin();
  const { data: nl } = await db.from('newsletters').select('*').eq('id', newsletterId).maybeSingle();
  if (!nl) return json(req, 404, { error: 'Newsletter introuvable.' });
  if (nl.sent_at && !test) return json(req, 400, { error: 'Cette newsletter a déjà été envoyée.' });

  let recipients: { email: string; token: string }[];
  if (test) recipients = [{ email: me.user.email!, token: 'test' }];
  else {
    const { data } = await db.from('newsletter_subscribers').select('email, token').eq('confirmed', true).is('unsubscribed_at', null);
    recipients = data || [];
  }
  if (recipients.length === 0) return json(req, 400, { error: 'Aucun abonné confirmé.' });

  const unsub = (t: string) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/newsletter-unsubscribe?token=${t}`;
  let sent = 0;
  const failed: string[] = [];
  for (const s of recipients) {
    try {
      await sendMail({
        to: s.email, subject: test ? `[TEST] ${nl.subject}` : nl.subject,
        html: layout({ title: nl.subject, body: nl.body_html, unsubscribeUrl: unsub(s.token) }),
        text: nl.body_text || nl.subject,
        headers: { 'List-Unsubscribe': `<${unsub(s.token)}>` },
      });
      sent++;
    } catch (e) { console.error('envoi', s.email, e); failed.push(s.email); }
  }
  if (sent === 0) return json(req, 500, { error: `Aucun email n'a pu partir (${failed.length} échec${failed.length > 1 ? 's' : ''}).` });
  if (!test) await db.from('newsletters').update({ sent_at: new Date().toISOString(), recipients: sent }).eq('id', nl.id);
  return json(req, 200, { sent, failed: failed.length, test: Boolean(test) });
});

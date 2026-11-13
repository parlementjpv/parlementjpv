import { admin, resend, json, isEmail, checkTurnstile, layout, button, SITE, FROM, cors, readJson } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const body = await readJson(req); if (!body) return json(req, 400, { error: 'Requête invalide' });
  const email = String(body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return json(req, 400, { error: 'Adresse email invalide.' });
  if (!body.fromSignup && !(await checkTurnstile(body.turnstileToken, req))) return json(req, 400, { error: 'Vérification anti-robot échouée, réessaie.' });

  const db = admin();
  const { data: existing } = await db.from('newsletter_subscribers').select('id, confirmed, token, unsubscribed_at').eq('email', email).maybeSingle();
  let token = existing?.token;
  if (existing?.confirmed && !existing.unsubscribed_at) return json(req, 200, { message: 'Tu es déjà abonné·e. Merci !' });
  if (!existing) {
    const { data, error } = await db.from('newsletter_subscribers').insert({ email }).select('token').single();
    if (error) return json(req, 500, { error: 'Erreur serveur, réessaie plus tard.' });
    token = data.token;
  } else if (existing.unsubscribed_at) {
    await db.from('newsletter_subscribers').update({ unsubscribed_at: null, confirmed: false }).eq('id', existing.id);
  }
  const confirmUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/newsletter-confirm?token=${token}`;
  try {
    await resend().emails.send({
      from: FROM, to: email, subject: 'Confirme ton inscription à la lettre du Parlement JPV',
      html: layout({ title: 'Une dernière étape', body: `<p>Pour recevoir la lettre du Parlement JPV, confirme ton adresse en cliquant ci-dessous.</p>${button(confirmUrl, 'Confirmer mon inscription')}<p style="font-size:13px;color:#5d6477;">Si tu n'es pas à l'origine de cette demande, ignore cet email : rien ne te sera envoyé.</p>` }),
      text: `Confirme ton inscription : ${confirmUrl}`,
    });
  } catch (e) { console.error('resend', e); return json(req, 500, { error: "L'email de confirmation n'a pas pu être envoyé." }); }
  return json(req, 200, { message: 'Presque fini : clique sur le lien reçu par email pour confirmer ton inscription.' });
});

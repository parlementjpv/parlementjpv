import { admin, page, json, isEmail, cors, readJson } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const db = admin();
  // Désinscription en un clic depuis le bouton « Se désabonner » de Gmail (POST avec le jeton dans l'URL)
  const jeton = new URL(req.url).searchParams.get('token') || '';
  if (req.method === 'POST' && /^[a-f0-9]{48}$/.test(jeton)) {
    await db.from('newsletter_subscribers').update({ unsubscribed_at: new Date().toISOString() }).eq('token', jeton);
    return new Response('ok', { status: 200 });
  }
  if (req.method === 'POST') {
    const body = await readJson(req); if (!body) return json(req, 400, { error: 'Requête invalide' });
    const email = String(body.email || '').trim().toLowerCase();
    if (!isEmail(email)) return json(req, 400, { error: 'Adresse email invalide.' });
    await db.from('newsletter_subscribers').update({ unsubscribed_at: new Date().toISOString() }).eq('email', email);
    return json(req, 200, { message: 'Si cette adresse était abonnée, elle est maintenant désinscrite.' });
  }
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!/^[a-f0-9]{48}$/.test(token)) return page(req, 'erreur');
  const { data } = await db.from('newsletter_subscribers').update({ unsubscribed_at: new Date().toISOString() }).eq('token', token).select('email').maybeSingle();
  if (!data) return page(req, 'erreur');
  return page(req, 'desinscrit');
});

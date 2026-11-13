import { admin, page, json, isEmail } from './_lib.mjs';

export default async (req) => {
  const db = admin();
  if (req.method === 'POST') {
    // Désinscription par email (formulaire du site) : on met à jour sans révéler si l'email existe.
    let body; try { body = await req.json(); } catch { return json(400, { error: 'Requête invalide' }); }
    const email = String(body.email || '').trim().toLowerCase();
    if (!isEmail(email)) return json(400, { error: 'Adresse email invalide.' });
    await db.from('newsletter_subscribers').update({ unsubscribed_at: new Date().toISOString() }).eq('email', email);
    return json(200, { message: 'Si cette adresse était abonnée, elle est maintenant désinscrite.' });
  }
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!/^[a-f0-9]{48}$/.test(token)) return page('Lien invalide', 'Ce lien de désinscription est invalide.', false);
  const { data } = await db.from('newsletter_subscribers').update({ unsubscribed_at: new Date().toISOString() }).eq('token', token).select('email').maybeSingle();
  if (!data) return page('Lien invalide', 'Ce lien de désinscription est invalide.', false);
  return page('Désinscription effectuée', `${data.email} ne recevra plus la newsletter. À bientôt peut-être !`);
};

export const config = { path: '/api/newsletter-unsubscribe' };

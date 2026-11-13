import { admin, page } from './_lib.mjs';

export default async (req) => {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!/^[a-f0-9]{48}$/.test(token)) return page('Lien invalide', 'Ce lien de confirmation est invalide.', false);
  const ip = req.headers.get('x-nf-client-connection-ip') || '';
  const { data, error } = await admin().from('newsletter_subscribers')
    .update({ confirmed: true, confirmed_at: new Date().toISOString(), confirm_ip: ip, unsubscribed_at: null })
    .eq('token', token).select('email').maybeSingle();
  if (error || !data) return page('Lien invalide', 'Ce lien de confirmation est invalide ou a expiré.', false);
  return page('Inscription confirmée', `Merci ! ${data.email} recevra désormais la newsletter du Parlement JPV.`);
};

export const config = { path: '/api/newsletter-confirm' };

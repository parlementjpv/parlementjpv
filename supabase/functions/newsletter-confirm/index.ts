import { admin, page } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!/^[a-f0-9]{48}$/.test(token)) return page(req, 'erreur');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '';
  const { data, error } = await admin().from('newsletter_subscribers')
    .update({ confirmed: true, confirmed_at: new Date().toISOString(), confirm_ip: ip, unsubscribed_at: null })
    .eq('token', token).select('email').maybeSingle();
  if (error || !data) return page(req, 'erreur');
  return page(req, 'merci');
});

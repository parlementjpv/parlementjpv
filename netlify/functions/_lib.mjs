import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const SITE = (process.env.URL || process.env.SITE_URL || 'https://parlementjpv.netlify.app').replace(/\/$/, '');
export const FROM = process.env.MAIL_FROM || 'Parlement JPV <newsletter@parlementjpv.fr>';
export const BUREAU_EMAIL = process.env.BUREAU_EMAIL || 'parlementjpv@gmail.com';

/** Client Supabase "service role" : uniquement côté serveur, contourne la RLS. */
export function admin() {
  const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Client Supabase au nom de l'utilisateur (vérifie son JWT). */
export async function userFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await admin().from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  return { user: data.user, profile };
}

export function resend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY manquant');
  return new Resend(process.env.RESEND_API_KEY);
}

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
export const html = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export const isEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length < 200;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Vérifie Cloudflare Turnstile si configuré (sinon laisse passer). */
export async function checkTurnstile(token, req) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '';
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  const d = await r.json().catch(() => ({}));
  return Boolean(d.success);
}

/** Gabarit d'email HTML aux couleurs du Parlement. */
export function layout({ title, body, unsubscribeUrl }) {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#f4efe4;font-family:Inter,Helvetica,Arial,sans-serif;color:#101828;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">
    <tr><td style="background:#0b2545;padding:22px 28px;color:#f6f1e6;">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#e3c766;">Lycée Jean-Pierre Vernant — Sèvres</div>
      <div style="font-family:Georgia,serif;font-size:22px;margin-top:4px;">Parlement JPV</div>
    </td></tr>
    <tr><td style="padding:28px;font-size:16px;line-height:1.6;">
      <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 16px;color:#0b2545;">${esc(title)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:18px 28px;background:#fbf9f4;font-size:12px;color:#5b6474;border-top:1px solid #e6e1d4;">
      Parlement JPV · Lycée Jean-Pierre Vernant, 92310 Sèvres · <a href="${SITE}" style="color:#5b6474;">parlementjpv</a>
      ${unsubscribeUrl ? ` · <a href="${unsubscribeUrl}" style="color:#5b6474;">Se désinscrire</a>` : ''}
    </td></tr>
  </table></td></tr></table></body></html>`;
}

export const button = (href, label) => `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#c9a227;color:#0b2545;font-weight:700;padding:12px 22px;border-radius:999px;text-decoration:none;">${esc(label)}</a></p>`;

/** Page HTML simple pour les liens de confirmation / désinscription. */
export function page(title, text, ok = true) {
  return html(200, `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="4;url=${SITE}/newsletter/${ok ? 'merci' : 'erreur'}"><title>${esc(title)}</title></head>
  <body style="font-family:sans-serif;background:#0b2545;color:#f6f1e6;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:20px;">
  <div><h1 style="font-family:Georgia,serif;">${esc(title)}</h1><p>${esc(text)}</p><p><a href="${SITE}" style="color:#e3c766;">Retour au site</a></p></div></body></html>`);
}

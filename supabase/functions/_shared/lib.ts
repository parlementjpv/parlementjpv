import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

export const SITE = (Deno.env.get('SITE_URL') || 'https://parlementjpv.github.io').replace(/\/$/, '');
export const FROM = Deno.env.get('MAIL_FROM') || `Parlement JPV <${Deno.env.get('SMTP_USER') || 'parlementjpv@gmail.com'}>`;
export const BUREAU_EMAIL = Deno.env.get('BUREAU_EMAIL') || 'parlementjpv@gmail.com';

const ALLOWED_ORIGINS = [SITE, 'https://parlementjpv.github.io', 'http://localhost:4321'];
export function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}

/** Client "service role" : uniquement côté serveur, contourne la RLS. Injecté automatiquement par Supabase. */
export function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

/** Utilisateur authentifié (JWT vérifié) + son profil. */
export async function userFromRequest(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const db = admin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await db.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  return { user: data.user, profile };
}

type Mail = { from?: string; to: string; subject: string; html: string; text?: string; replyTo?: string; headers?: Record<string, string> };
let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

/** Envoi d'emails via Gmail (SMTP, port 465 SSL). Identifiants dans les secrets SMTP_USER / SMTP_PASS. */
export async function sendMail(m: Mail) {
  if (!transport) {
    const user = Deno.env.get('SMTP_USER'), pass = Deno.env.get('SMTP_PASS');
    if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS manquants');
    transport = nodemailer.createTransport({ host: Deno.env.get('SMTP_HOST') || 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  }
  return await transport.sendMail({ from: m.from || FROM, to: m.to, subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo, headers: m.headers });
}

export const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });

export const isEmail = (e: unknown) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length < 200;
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export async function checkTurnstile(token: string, req: Request) {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true;
  if (!token) return false;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '';
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  const d = await r.json().catch(() => ({}));
  return Boolean(d.success);
}

export function layout({ title, body, unsubscribeUrl }: { title: string; body: string; unsubscribeUrl?: string }) {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#e9ebf0;font-family:Helvetica,Arial,sans-serif;color:#0f1f4b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" style="max-width:600px;background:#fff;border:3px solid #0f1f4b;">
    <tr><td style="background:#0f1f4b;padding:20px 28px;color:#fff;">
      <div style="font-size:22px;font-weight:800;">Parlement JPV</div>
      <div style="font-size:12px;color:#ff6b78;font-weight:700;">Lycée Jean-Pierre Vernant — Sèvres</div>
    </td></tr>
    <tr><td style="padding:28px;font-size:16px;line-height:1.55;">
      <h1 style="font-size:26px;line-height:1.05;margin:0 0 16px;color:#0f1f4b;">${esc(title)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#e9ebf0;font-size:12px;color:#5d6477;">
      Parlement JPV · Lycée Jean-Pierre Vernant, 92310 Sèvres · <a href="${SITE}" style="color:#5d6477;">${SITE.replace('https://', '')}</a>
      ${unsubscribeUrl ? ` · <a href="${unsubscribeUrl}" style="color:#5d6477;">Se désinscrire</a>` : ''}
    </td></tr>
  </table></td></tr></table></body></html>`;
}
export const button = (href: string, label: string) => `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#d62839;color:#fff;font-weight:700;padding:13px 22px;text-decoration:none;">${esc(label)}</a></p>`;

/** Page HTML pour les liens cliqués depuis un email (confirmation / désinscription), puis retour au site. */
export function page(req: Request, title: string, text: string, ok = true) {
  const to = `${SITE}/newsletter/${ok ? 'merci' : 'erreur'}`;
  return new Response(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="3;url=${to}"><title>${esc(title)}</title></head>
  <body style="font-family:sans-serif;background:#0f1f4b;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:20px;">
  <div><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="${to}" style="color:#ff6b78;">Retour au site</a></p></div></body></html>`,
    { status: 200, headers: { ...cors(req), 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function readJson(req: Request) { try { return await req.json(); } catch { return null; } }

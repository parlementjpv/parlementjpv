import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

export const SITE = (Deno.env.get('SITE_URL') || 'https://parlementjpv.github.io').replace(/\/$/, '');
export const FROM = Deno.env.get('MAIL_FROM') || `Parlement JPV <${Deno.env.get('SMTP_USER') || 'parlementjpv@gmail.com'}>`;
export const BUREAU_EMAIL = Deno.env.get('BUREAU_EMAIL') || 'parlementjpv@gmail.com';

const ALLOWED_ORIGINS = [SITE, 'https://parlementjpv.github.io', 'http://localhost:4321'];
export function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin) ? origin : ALLOWED_ORIGINS[0];
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

type Mail = { from?: string; to: string; subject: string; html: string; text?: string; replyTo?: string; headers?: Record<string, string>; attachments?: { filename: string; content: Uint8Array | string; contentType?: string }[] };
let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

/** Envoi d'emails via Gmail (SMTP, port 465 SSL). Identifiants dans les secrets SMTP_USER / SMTP_PASS. */
export async function sendMail(m: Mail) {
  if (!transport) {
    const user = Deno.env.get('SMTP_USER'), pass = Deno.env.get('SMTP_PASS');
    if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS manquants');
    transport = nodemailer.createTransport({ host: Deno.env.get('SMTP_HOST') || 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  }
  // Anti-spam : version texte, réponses autorisées vers la boîte du Parlement, lien de désinscription dans l'en-tête
  const repondre = Deno.env.get('SMTP_USER') || 'parlementjpv@gmail.com';
  const headers: Record<string, string> = { ...(m.headers || {}) };
  if (!headers['List-Unsubscribe']) headers['List-Unsubscribe'] = `<mailto:${repondre}?subject=D%C3%A9sinscription>`;
  else if (!headers['List-Unsubscribe'].includes('mailto:')) headers['List-Unsubscribe'] += `, <mailto:${repondre}?subject=D%C3%A9sinscription>`;
  if (/^<https:/.test(headers['List-Unsubscribe']) && !headers['List-Unsubscribe-Post']) headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  return await transport.sendMail({ from: m.from || FROM, to: m.to, subject: m.subject, html: m.html, text: m.text || versionTexte(m.html), replyTo: m.replyTo || repondre, headers, attachments: m.attachments });
}

/** Version texte lisible d'un email HTML (liens conservés entre parenthèses) */
export function versionTexte(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => { const txt = t.replace(/<[^>]+>/g, '').trim(); return txt && !href.includes(txt) ? `${txt} (${href})` : href; })
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, '\n\n').replace(/<li[^>]*>/gi, '- ').replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
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

// Modèle d'email du Parlement (variante A3 choisie) : carte arrondie, en-tête bleu nuit avec logo, bande tricolore
export function layout({ title, body, unsubscribeUrl }: { title: string; body: string; unsubscribeUrl?: string }) {
  const tri = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;background:#0f1f4b;width:33%;font-size:0;line-height:0;">&nbsp;</td><td style="height:6px;background:#ffffff;width:34%;font-size:0;line-height:0;">&nbsp;</td><td style="height:6px;background:#d62839;width:33%;font-size:0;line-height:0;">&nbsp;</td></tr></table>';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
  <body style="margin:0;padding:0;background:#e9ebf0;font-family:Helvetica,Arial,sans-serif;color:#0f1f4b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9ebf0;"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(15,31,75,.12);">
    <tr><td style="background:#0f1f4b;padding:20px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td><img src="${SITE}/assets/img/icon-192.png" width="42" height="42" alt="Parlement JPV" style="display:block;border:0;border-radius:8px;"></td>
        <td style="padding-left:12px;color:#ffffff;"><div style="font-size:19px;font-weight:800;line-height:1.2;">Parlement JPV</div><div style="font-size:12px;color:#ff8a95;font-weight:700;">Lycée Jean-Pierre Vernant · Sèvres</div></td>
      </tr></table>
    </td></tr>
    <tr><td>${tri}</td></tr>
    <tr><td style="padding:32px 30px;font-size:16px;line-height:1.6;color:#0f1f4b;">
      <h1 style="font-size:26px;line-height:1.12;margin:0 0 18px;color:#0f1f4b;">${esc(title)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:18px 30px;border-top:1px solid #e9ebf0;font-size:12px;line-height:1.5;color:#5d6477;">
      Parlement JPV · Lycée Jean-Pierre Vernant, 92310 Sèvres<br><a href="${SITE}" style="color:#5d6477;">${SITE.replace('https://', '').replace(/\/parlementjpv$/, '')}</a> · Tu peux répondre à cet email.${unsubscribeUrl ? ` · <a href="${unsubscribeUrl}" style="color:#5d6477;">Se désinscrire</a>` : ''}
    </td></tr>
  </table></td></tr></table></body></html>`;
}
export const button = (href: string, label: string) => `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#d62839;color:#ffffff;font-weight:700;padding:14px 26px;text-decoration:none;border-radius:8px;">${esc(label)}</a></p>`;

/** Lien cliqué depuis un email : redirection immédiate vers la bonne page du site
 *  (Supabase n'affiche pas le HTML servi par les fonctions : il apparaissait en code brut). */
export function page(_req: Request, dest: 'merci' | 'desinscrit' | 'erreur') {
  const to = dest === 'merci' ? `${SITE}/newsletter/merci` : dest === 'desinscrit' ? `${SITE}/newsletter/desinscription?fait=1` : `${SITE}/newsletter/erreur`;
  return new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store' } });
}

export async function readJson(req: Request) { try { return await req.json(); } catch { return null; } }

/** Journal des actions du bureau (lisible par l'admin). Ne bloque jamais l'action en cas d'échec. */
export async function journal(acteur: string, categorie: string, resume: string) {
  try { await admin().rpc('journaliser', { p_categorie: categorie, p_resume: resume, p_acteur: acteur }); } catch (e) { console.error('journal', e); }
}

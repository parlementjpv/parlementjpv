import { ImapFlow } from 'npm:imapflow@1.0.164';
import PostalMime from 'npm:postal-mime@2.3.2';
const simpleParser = async (src: Uint8Array) => {
  const e: any = await PostalMime.parse(src);
  const adr = (a: any) => a ? { name: a.name || '', address: a.address || '' } : null;
  const liste = (l: any[] | undefined) => (l || []).map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ');
  return { subject: e.subject, from: adr(e.from), replyTo: adr(e.replyTo?.[0]), to: liste(e.to), cc: liste(e.cc), date: e.date ? new Date(e.date) : null, messageId: e.messageId, references: e.references ? String(e.references).split(/\s+/).filter(Boolean) : [], html: e.html || null, text: e.text || '', attachments: (e.attachments || []).map((a: any) => ({ filename: a.filename, contentType: a.mimeType, content: new Uint8Array(a.content), size: (a.content?.byteLength) || 0 })) };
};
import MailComposer from 'npm:nodemailer@6.9.16/lib/mail-composer/index.js';
import { sendMail, json, cors, readJson, userFromRequest, journal, FROM } from '../_shared/lib.ts';

// Boîte contact@parlementjpv.fr dans l'espace bureau — réservée aux administrateurs.
// IMAP (lecture) : ssl0.ovh.net:993 · SMTP (réponse) : via sendMail. Identifiants : secrets SMTP_USER / SMTP_PASS.
const HOTE = Deno.env.get('IMAP_HOST') || 'ssl0.ovh.net';
const connecter = async () => {
  const c = new ImapFlow({ host: HOTE, port: 993, secure: true, auth: { user: Deno.env.get('SMTP_USER')!, pass: Deno.env.get('SMTP_PASS')! }, logger: false });
  await c.connect(); return c;
};
const DOSSIERS: Record<string, string[]> = { inbox: ['INBOX'], envoyes: ['Sent', 'Envoyés', 'INBOX.Sent'], corbeille: ['Trash', 'Corbeille', 'INBOX.Trash'], spam: ['Junk', 'Spam', 'INBOX.Junk'] };
async function chemin(c: ImapFlow, cle: string) {
  if (cle === 'inbox') return 'INBOX';
  const list = await c.list();
  const special = { envoyes: '\\Sent', corbeille: '\\Trash', spam: '\\Junk' }[cle];
  const f = list.find((x) => x.specialUse === special) || list.find((x) => DOSSIERS[cle]?.some((n) => x.path.toLowerCase() === n.toLowerCase() || x.name.toLowerCase() === n.toLowerCase()));
  return f?.path || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  if (me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = (await readJson(req)) || {};
  let c: ImapFlow | null = null;
  try {
    c = await connecter();
    const dossier = await chemin(c, String(b.dossier || 'inbox'));
    if (!dossier) return json(req, 404, { error: 'Dossier introuvable.' });
    const lock = await c.getMailboxLock(dossier);
    try {
      if (b.action === 'liste') {
        const total = (c.mailbox as any).exists as number, par = 30, page = Math.max(0, Number(b.page) || 0);
        const fin = total - page * par, debut = Math.max(1, fin - par + 1);
        const items: any[] = [];
        if (fin >= 1) for await (const m of c.fetch(`${debut}:${fin}`, { uid: true, envelope: true, flags: true, bodyStructure: true })) {
          const e = m.envelope!;
          items.push({ uid: m.uid, sujet: e.subject || '(sans objet)', de: e.from?.[0] ? { nom: e.from[0].name || '', email: e.from[0].address || '' } : null, a: (e.to || []).map((x) => x.address).join(', '), date: e.date, lu: m.flags?.has('\\Seen'), pj: JSON.stringify(m.bodyStructure || {}).includes('"disposition":"attachment"') });
        }
        const nonLus = (await c.status(dossier, { unseen: true })).unseen;
        return json(req, 200, { items: items.reverse(), total, page, pages: Math.ceil(total / par), nonLus });
      }
      const uid = Number(b.uid); if (!uid) return json(req, 400, { error: 'Message manquant.' });
      if (b.action === 'diag') {
        const t0 = Date.now(), etapes: string[] = [];
        const lim = <T,>(p: Promise<T>, n: string) => Promise.race([p.then((v) => { etapes.push(`${n} ok ${Date.now() - t0}ms`); return v; }), new Promise<T>((_, r) => setTimeout(() => r(new Error(n + ' timeout')), 15000))]);
        try {
          const env: any = await lim(c.fetchOne(String(uid), { envelope: true, size: true }, { uid: true }), 'envelope');
          etapes.push('taille ' + env?.size);
          const st: any = await lim(c.fetchOne(String(uid), { bodyStructure: true }, { uid: true }), 'structure');
          const dl: any = await lim(c.download(String(uid), undefined, { uid: true }), 'download');
          const chunks: Uint8Array[] = []; await lim((async () => { for await (const ch of dl.content) chunks.push(ch); })(), 'lecture flux');
          etapes.push('octets ' + chunks.reduce((a, x) => a + x.length, 0));
          const src: any = await lim(c.fetchOne(String(uid), { source: true }, { uid: true }), 'source');
          etapes.push('source ' + src?.source?.length);
        } catch (e) { etapes.push('ERREUR ' + (e as Error).message); }
        return json(req, 200, { etapes });
      }
      if (b.action === 'lire') {
        const m = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
        if (!m) return json(req, 404, { error: 'Message introuvable.' });
        const p = await simpleParser(m.source);
        await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        return json(req, 200, { uid, sujet: p.subject || '(sans objet)', de: p.from, a: p.to, cc: p.cc, date: p.date, messageId: p.messageId, references: p.references, html: p.html || null, texte: p.text || '', pj: (p.attachments || []).map((a, i) => ({ i, nom: a.filename || `piece-jointe-${i + 1}`, type: a.contentType, taille: a.size })) });
      }
      if (b.action === 'pj') {
        const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
        const a = m && (await simpleParser(m.source)).attachments?.[Number(b.i)];
        if (!a) return json(req, 404, { error: 'Pièce jointe introuvable.' });
        let s = ''; const u8 = new Uint8Array(a.content); for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768));
        return json(req, 200, { nom: a.filename, type: a.contentType, base64: btoa(s) });
      }
      if (b.action === 'nonlu') { await c.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true }); return json(req, 200, { ok: true }); }
      if (b.action === 'supprimer') {
        const corb = await chemin(c, 'corbeille');
        if (corb && corb !== dossier) await c.messageMove(String(uid), corb, { uid: true }); else await c.messageDelete(String(uid), { uid: true });
        await journal(me.user.id, 'Boîte mail', `a supprimé un message de la boîte contact`);
        return json(req, 200, { ok: true });
      }
      if (b.action === 'repondre') {
        const texte = String(b.texte || '').trim(); if (texte.length < 2) return json(req, 400, { error: 'Écris ta réponse.' });
        const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
        const p = m && await simpleParser(m.source); if (!p) return json(req, 404, { error: 'Message introuvable.' });
        const dest = (p.replyTo || p.from)?.address; if (!dest) return json(req, 400, { error: 'Adresse de réponse introuvable.' });
        const sujet = /^re\s*:/i.test(p.subject || '') ? p.subject! : `Re: ${p.subject || ''}`;
        const cite = (p.text || '').split('\n').map((l) => '> ' + l).join('\n');
        const corps = `${texte}\n\n— \nParlement JPV · Lycée Jean-Pierre Vernant, Sèvres\nhttps://parlementjpv.fr\n\nLe ${p.date?.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}, ${p.from?.name ? `${p.from.name} <${p.from.address}>` : p.from?.address} a écrit :\n${cite}`;
        const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f1f4b;white-space:pre-wrap;">${texte.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]!))}</div><p style="font-family:Arial,sans-serif;font-size:13px;color:#5d6477;margin-top:20px;">Parlement JPV · Lycée Jean-Pierre Vernant, Sèvres<br><a href="https://parlementjpv.fr" style="color:#5d6477;">parlementjpv.fr</a></p>`;
        const refs = [...p.references, p.messageId].filter(Boolean) as string[];
        await sendMail({ from: FROM, to: dest, subject: sujet, text: corps, html, inReplyTo: p.messageId, references: refs, brut: true } as any);
        await c.messageFlagsAdd(String(uid), ['\\Answered', '\\Seen'], { uid: true });
        // Copie dans « Envoyés » pour garder le fil complet dans la boîte
        try {
          const env = await chemin(c, 'envoyes');
          if (env) { const raw: Uint8Array = await new MailComposer({ from: FROM, to: dest, subject: sujet, text: corps, html, inReplyTo: p.messageId, references: refs, date: new Date() }).compile().build(); await c.append(env, raw, ['\\Seen']); }
        } catch (e) { console.error('copie envoyés', e); }
        await journal(me.user.id, 'Boîte mail', `a répondu à un message de la boîte contact`);
        return json(req, 200, { ok: true, a: dest });
      }
      return json(req, 400, { error: 'Action inconnue.' });
    } finally { try { lock.release(); } catch { /* déjà libéré */ } }
  } catch (e) {
    console.error(e);
    return json(req, 502, { error: 'Connexion à la boîte mail impossible pour le moment.' });
  } finally { try { await c?.logout(); } catch { /* */ } }
});

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


/** Téléchargement brut d'un message par une connexion IMAP directe (TLS natif de Deno : fiable pour les gros messages). */
async function sourceBrute(dossier: string, uid: number): Promise<Uint8Array> {
  const conn = await Deno.connectTls({ hostname: HOTE, port: 993 });
  const enc = new TextEncoder(), dec = new TextDecoder('latin1');
  let buf = new Uint8Array(0);
  const lire = async () => { const t = new Uint8Array(65536); const n = await conn.read(t); if (n === null) throw new Error('connexion fermée'); const nb = new Uint8Array(buf.length + n); nb.set(buf); nb.set(t.subarray(0, n), buf.length); buf = nb; };
  const jusqua = async (tag: string) => { while (true) { const txt = dec.decode(buf); const i = txt.search(new RegExp(`(^|\r\n)${tag} (OK|NO|BAD)[^\r]*\r\n`)); if (i >= 0) { const ok = new RegExp(`${tag} OK`).test(txt.slice(i)); const out = buf; buf = new Uint8Array(0); if (!ok) throw new Error(`IMAP ${tag} refusé`); return out; } await lire(); } };
  const cmd = async (tag: string, c: string) => { await conn.write(enc.encode(`${tag} ${c}\r\n`)); return jusqua(tag); };
  const q = (x: string) => '"' + x.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  try {
    while (!dec.decode(buf).includes('\r\n')) await lire(); buf = new Uint8Array(0);
    await cmd('a1', `LOGIN ${q(Deno.env.get('SMTP_USER')!)} ${q(Deno.env.get('SMTP_PASS')!)}`);
    await cmd('a2', `EXAMINE ${q(dossier)}`);
    const r = await cmd('a3', `UID FETCH ${uid} BODY.PEEK[]`);
    const txt = dec.decode(r); const m = /BODY\[\] \{(\d+)\}\r\n/.exec(txt);
    if (!m) throw new Error('message introuvable');
    const debut = m.index + m[0].length; // latin1 : 1 caractère = 1 octet
    return r.slice(debut, debut + Number(m[1]));
  } finally { try { await conn.write(enc.encode('a9 LOGOUT\r\n')); } catch { /* */ } try { conn.close(); } catch { /* */ } }
}


/** Signature professionnelle de l'administrateur qui écrit (HTML + texte). */
function signature(prof: any) {
  const e = (x: string) => String(x || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const nom = [prof?.prenom, prof?.nom].filter(Boolean).join(' ') || 'Le bureau';
  const fonction = prof?.poste ? `${prof.poste} du Parlement JPV` : 'Administrateur du Parlement JPV';
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;font-family:Arial,Helvetica,sans-serif;border-collapse:collapse;">
  <tr><td colspan="2" style="padding-bottom:14px;"><div style="width:48px;height:3px;background:#d62839;font-size:0;line-height:0;">&nbsp;</div></td></tr>
  <tr>
    <td style="vertical-align:top;padding-right:16px;border-right:2px solid #0f1f4b;"><img src="https://parlementjpv.fr/assets/img/icon-192.png" width="64" height="64" alt="Parlement JPV" style="display:block;border:0;border-radius:10px;"></td>
    <td style="vertical-align:top;padding-left:16px;">
      <div style="font-size:16px;font-weight:700;color:#0f1f4b;line-height:1.3;">${e(nom)}</div>
      <div style="font-size:13px;font-weight:700;color:#d62839;line-height:1.4;margin-bottom:8px;">${e(fonction)}</div>
      <div style="font-size:12.5px;color:#4a5370;line-height:1.55;">Lycée Jean-Pierre Vernant<br>21 rue du Docteur Ledermann, 92310 Sèvres<br>
        <a href="mailto:contact@parlementjpv.fr" style="color:#0f1f4b;text-decoration:none;">contact@parlementjpv.fr</a> · <a href="https://parlementjpv.fr" style="color:#0f1f4b;font-weight:700;text-decoration:none;">parlementjpv.fr</a></div>
    </td>
  </tr></table>`;
  const texte = `\n\n--\n${nom}\n${fonction}\nLycée Jean-Pierre Vernant, 92310 Sèvres\ncontact@parlementjpv.fr · https://parlementjpv.fr`;
  return { html, texte };
}

async function un(c: ImapFlow, uid: number, q: Record<string, unknown>) {
  let r: any = null;
  for await (const m of c.fetch(String(uid), q as any, { uid: true })) r = m; // on lit le flux jusqu'au bout
  return r;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  if (me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = (await readJson(req)) || {};
  // Nouveau message (hors fil) : pas besoin d'ouvrir de dossier
  if (b.action === 'envoyer') {
    const tous = String(b.a || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const cc = String(b.cc || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const sujet = String(b.sujet || '').trim().slice(0, 200), texte = String(b.texte || '').trim().slice(0, 20000);
    const valide = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
    if (!tous.length || [...tous, ...cc].some((e) => !valide(e))) return json(req, 400, { error: 'Adresse de destinataire invalide.' });
    if (tous.length + cc.length > 20) return json(req, 400, { error: '20 destinataires maximum. Pour écrire à tous les membres, utilise « Diffuser une annonce ».' });
    if (!sujet || texte.length < 2) return json(req, 400, { error: 'Objet et message obligatoires.' });
    const sig = signature(me.profile);
    const corps = `${texte}${sig.texte}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f1f4b;white-space:pre-wrap;">${texte.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]!))}</div>${sig.html}`;
    try {
      await sendMail({ from: FROM, to: tous.join(', '), cc: cc.length ? cc.join(', ') : undefined, subject: sujet, text: corps, html, brut: true } as any);
    } catch (e) { console.error(e); return json(req, 502, { error: "L'envoi a échoué. Réessaie dans un instant." }); }
    let c2: ImapFlow | null = null;
    try { c2 = await connecter(); const env = await chemin(c2, 'envoyes'); if (env) { const raw: Uint8Array = await new MailComposer({ from: FROM, to: tous.join(', '), cc: cc.join(', ') || undefined, subject: sujet, text: corps, html, date: new Date() }).compile().build(); await c2.append(env, raw, ['\\Seen']); } }
    catch (e) { console.error('copie envoyés', e); } finally { try { c2?.close(); } catch { /* */ } }
    await journal(me.user.id, 'Boîte mail', `a envoyé un email depuis contact@ (« ${sujet.slice(0, 60)} »)`);
    return json(req, 200, { ok: true, a: tous.join(', ') });
  }
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
      if (b.action === 'lire') {
        const p = await simpleParser(await sourceBrute(dossier, uid));
        await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        return json(req, 200, { uid, sujet: p.subject || '(sans objet)', de: p.from, a: p.to, cc: p.cc, date: p.date, messageId: p.messageId, references: p.references, html: p.html || null, texte: p.text || '', pj: (p.attachments || []).map((a, i) => ({ i, nom: a.filename || `piece-jointe-${i + 1}`, type: a.contentType, taille: a.size })) });
      }
      if (b.action === 'pj') {
        const a = (await simpleParser(await sourceBrute(dossier, uid))).attachments?.[Number(b.i)];
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
        const p = await simpleParser(await sourceBrute(dossier, uid));
        const dest = (p.replyTo || p.from)?.address; if (!dest) return json(req, 400, { error: 'Adresse de réponse introuvable.' });
        const sujet = /^re\s*:/i.test(p.subject || '') ? p.subject! : `Re: ${p.subject || ''}`;
        const cite = (p.text || '').split('\n').map((l) => '> ' + l).join('\n');
        const sig = signature(me.profile);
        const corps = `${texte}${sig.texte}\n\nLe ${p.date?.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}, ${p.from?.name ? `${p.from.name} <${p.from.address}>` : p.from?.address} a écrit :\n${cite}`;
        const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f1f4b;white-space:pre-wrap;">${texte.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]!))}</div>${sig.html}`;
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
  } finally { try { c?.close(); } catch { /* */ } }
});

import { admin, sendMail, json, esc, layout, button, SITE, FROM, BUREAU_EMAIL, cors, readJson, userFromRequest, journal } from '../_shared/lib.ts';
import { pushUtilisateurs } from '../_shared/push.ts';
import { mailWhatsApp } from '../_shared/whatsapp.ts';

// Diffusion d'une annonce sur plusieurs canaux d'un coup : email aux membres, newsletter, notification push, WhatsApp.
// test:true => uniquement à l'auteur (email + push sur ses appareils + texte WhatsApp à lui).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me?.user.email) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req);
  const titre = String(b?.titre || '').trim().slice(0, 120), message = String(b?.message || '').trim().slice(0, 5000);
  let lien = String(b?.lien || '').trim().slice(0, 500);
  if (lien && !/^https?:\/\//.test(lien)) lien = '';
  const c = b?.canaux || {};
  if (!titre || message.length < 3) return json(req, 400, { error: 'Titre et message obligatoires.' });
  if (!c.email && !c.newsletter && !c.push && !c.whatsapp) return json(req, 400, { error: 'Coche au moins un moyen de communication.' });
  const test = !!b.test;
  const db = admin();
  const corps = (prenom?: string) => `${prenom ? `<p>Bonjour ${esc(prenom)},</p>` : ''}<div style="white-space:pre-wrap;">${esc(message)}</div>${lien ? button(lien, 'En savoir plus') : ''}<p style="margin-top:24px;">Le bureau du Parlement JPV</p>`;
  const texteBrut = (prenom?: string) => `${prenom ? `Bonjour ${prenom},\n\n` : ''}${message}${lien ? `\n\n${lien}` : ''}\n\nLe bureau du Parlement JPV`;
  const sujet = (test ? '[TEST] ' : '') + titre;
  const r = { email: 0, newsletter: 0, push: 0, whatsapp: false, echecs: 0 };
  const dejaEcrits = new Set<string>();

  if (c.email) {
    let dest: { email: string; prenom: string }[];
    if (test) dest = [{ email: me.user.email, prenom: me.profile?.prenom || '' }];
    else {
      const [{ data: adhs }, { data: bannis }] = await Promise.all([
        db.from('adhesions').select('email, prenom, user_id').not('user_id', 'is', null),
        db.from('profiles').select('id').eq('banni', true),
      ]);
      const ex = new Set((bannis || []).map((p) => p.id));
      dest = (adhs || []).filter((a) => !ex.has(a.user_id));
    }
    for (const d of dest) {
      const k = d.email.toLowerCase(); if (dejaEcrits.has(k)) continue; dejaEcrits.add(k);
      try { await sendMail({ from: FROM, to: d.email, replyTo: BUREAU_EMAIL, subject: sujet, html: layout({ title: titre, body: corps(d.prenom) }), text: texteBrut(d.prenom) }); r.email++; } catch (e) { console.error(e); r.echecs++; }
    }
  }
  if (c.newsletter) {
    const unsub = (t: string) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/newsletter-unsubscribe?token=${t}`;
    let dest: { email: string; token: string }[];
    if (test) dest = dejaEcrits.has(me.user.email.toLowerCase()) ? [] : [{ email: me.user.email, token: 'test' }];
    else { const { data } = await db.from('newsletter_subscribers').select('email, token').eq('confirmed', true).is('unsubscribed_at', null); dest = data || []; }
    for (const d of dest) {
      const k = d.email.toLowerCase(); if (dejaEcrits.has(k)) continue; dejaEcrits.add(k); // déjà reçu en tant que membre
      try { await sendMail({ from: FROM, to: d.email, subject: sujet, html: layout({ title: titre, body: corps(), unsubscribeUrl: unsub(d.token) }), text: texteBrut(), headers: { 'List-Unsubscribe': `<${unsub(d.token)}>` } }); r.newsletter++; } catch (e) { console.error(e); r.echecs++; }
    }
  }
  if (c.push) {
    let ids: string[];
    if (test) ids = [me.user.id];
    else { const { data } = await db.from('profiles').select('id').eq('banni', false); ids = (data || []).map((x) => x.id); }
    const court = message.replace(/\s+/g, ' ').slice(0, 180) + (message.length > 180 ? '…' : '');
    const { envoyes } = await pushUtilisateurs(ids, { titre, texte: court, url: lien || `${SITE}/compte` });
    r.push = envoyes;
  }
  if (c.whatsapp) {
    const wa = `📢 *${titre}*\n\n${message}${lien ? `\n\n👉 ${lien}` : ''}`;
    try { await sendMail({ from: FROM, to: test ? me.user.email : BUREAU_EMAIL, subject: `${test ? '[TEST] ' : ''}WhatsApp : ${titre}`, html: mailWhatsApp('Une annonce vient d\'être diffusée depuis l\'espace bureau.', wa), text: wa }); r.whatsapp = true; } catch (e) { console.error(e); }
  }
  if (!test) {
    const canaux = [c.email && `email (${r.email})`, c.newsletter && `newsletter (${r.newsletter})`, c.push && `notification (${r.push} appareil${r.push > 1 ? 's' : ''})`, c.whatsapp && 'WhatsApp'].filter(Boolean).join(', ');
    await journal(me.user.id, 'Communication', `a diffusé « ${titre} » : ${canaux}`);
  }
  return json(req, 200, { ok: true, test, ...r });
});

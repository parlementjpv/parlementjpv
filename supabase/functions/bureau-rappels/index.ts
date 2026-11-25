import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest } from '../_shared/lib.ts';

// Rappels internes du bureau.
//  - Tous les jours (pg_cron, clé serveur) : tâche à rendre demain, tâche en retard (une seule relance), réunion du lendemain.
//  - Depuis l'espace bureau : { action: 'tache', id } prévient la personne à qui on vient d'attribuer une tâche ;
//    { action: 'convoquer', id } envoie la convocation et l'ordre du jour à tout le bureau.
type Db = ReturnType<typeof admin>;
const jourParis = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
const dateLongue = (d: string) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const heure = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
const lienBureau = `${SITE}/bureau/`;
const paras = (t: string) => esc(t).split(/\n+/).filter(Boolean).map((l) => `<p style="margin:0 0 6px;">${l}</p>`).join('');

async function emailDe(db: Db, id: string | null) {
  if (!id) return null;
  const { data } = await db.auth.admin.getUserById(id);
  const { data: p } = await db.from('profiles').select('prenom, role').eq('id', id).maybeSingle();
  if (!data?.user?.email || !p || !['bureau', 'admin'].includes(p.role)) return null;
  return { email: data.user.email, prenom: p.prenom || '' };
}

function blocTache(t: any) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;"><tr><td style="border-left:4px solid #0b1d3a;background:#f3f4f7;border-radius:6px;padding:14px 16px;">
    <strong style="font-size:16px;">${esc(t.titre)}</strong>${t.details ? `<div style="margin-top:6px;font-size:14px;color:#4a5370;">${paras(t.details)}</div>` : ''}
    ${t.echeance ? `<div style="margin-top:8px;font-size:13.5px;"><strong>À faire avant le ${esc(dateLongue(t.echeance + 'T12:00:00Z'))}</strong></div>` : ''}</td></tr></table>`;
}

async function mailTache(db: Db, t: any, genre: 'nouvelle' | 'veille' | 'retard', par = '') {
  const d = await emailDe(db, t.assigne_a); if (!d) return false;
  const sujet = genre === 'nouvelle' ? `Nouvelle tâche pour toi : ${t.titre}` : genre === 'veille' ? `À faire pour demain : ${t.titre}` : `Tâche en retard : ${t.titre}`;
  const titre = genre === 'nouvelle' ? `${d.prenom}, une tâche t'a été confiée` : genre === 'veille' ? `${d.prenom}, c'est pour demain` : `${d.prenom}, cette tâche a dépassé son échéance`;
  const intro = genre === 'nouvelle' ? `${par ? `<strong>${esc(par)}</strong> t'a` : 'On t\'a'} attribué une tâche dans l'espace bureau.` : genre === 'veille' ? "Petit rappel : cette tâche doit être faite d'ici demain." : "Cette tâche n'est pas encore marquée comme faite. Si c'est fait, coche-la ; sinon, préviens le bureau dans « Entre nous ».";
  await sendMail({ from: FROM, to: d.email, subject: sujet, html: layout({ title: titre, body: `<p>${intro}</p>${blocTache(t)}${button(lienBureau, 'Ouvrir mes tâches')}<p style="font-size:13px;color:#5d6477;">Une fois terminée, passe-la en « Fait » : tu ne recevras plus de rappel.</p>` }) });
  return true;
}

async function mailReunion(db: Db, r: any, genre: 'convocation' | 'rappel', seulement: string | null = null) {
  const { data: bur } = await db.from('profiles').select('id').in('role', ['bureau', 'admin']).eq('banni', false);
  let n = 0;
  for (const p of bur || []) {
    const d = await emailDe(db, p.id); if (!d || (seulement && d.email.toLowerCase() !== seulement)) continue;
    try {
      await sendMail({ from: FROM, to: d.email, subject: `${genre === 'rappel' ? 'Demain : ' : 'Convocation : '}${r.titre} — ${dateLongue(r.quand)} à ${heure(r.quand)}`,
        html: layout({ title: genre === 'rappel' ? `${d.prenom}, réunion du bureau demain` : `${d.prenom}, tu es convoqué·e à la réunion du bureau`, body:
          `<p><strong>${esc(r.titre)}</strong><br>${esc(dateLongue(r.quand))} à ${heure(r.quand)}${r.lieu ? ` · ${esc(r.lieu)}` : ''}</p>
           <p style="margin:16px 0 6px;"><strong>Ordre du jour</strong></p>
           <div style="border-left:4px solid #d62839;background:#fdf6f6;border-radius:6px;padding:12px 16px;font-size:14.5px;">${r.ordre_du_jour ? paras(r.ordre_du_jour) : '<em>À compléter dans l\'espace bureau.</em>'}</div>
           <p>Tu peux compléter l'ordre du jour avant la réunion.</p>${button(lienBureau, 'Voir la réunion')}` }) });
      n++;
    } catch (e) { console.error(e); }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const db = admin();
  const b = (await readJson(req)) || {};
  const secret = Deno.env.get('BACKUP_SECRET');

  if (secret && req.headers.get('x-sauvegarde') === secret) {
    const seulement = b.seulement ? String(b.seulement).toLowerCase() : null;
    if (b.convoquerTest) { const { data: r } = await db.from('bureau_reunions').select('*').eq('id', b.convoquerTest).maybeSingle(); return json(req, 200, { ok: true, emails: r ? await mailReunion(db, r, 'convocation', seulement) : 0 }); }
    const auj = jourParis(new Date()), demain = jourParis(new Date(Date.now() + 86400000));
    const bilan = { veille: 0, retard: 0, reunions: 0 };
    const { data: tv } = await db.from('bureau_taches').select('*').neq('statut', 'fait').eq('echeance', demain).is('rappel_veille_at', null).not('assigne_a', 'is', null);
    for (const t of tv || []) { await db.from('bureau_taches').update({ rappel_veille_at: new Date().toISOString() }).eq('id', t.id); try { if (await mailTache(db, t, 'veille')) bilan.veille++; } catch (e) { console.error(e); } }
    const { data: tr } = await db.from('bureau_taches').select('*').neq('statut', 'fait').lt('echeance', auj).is('rappel_retard_at', null).not('assigne_a', 'is', null);
    for (const t of tr || []) { await db.from('bureau_taches').update({ rappel_retard_at: new Date().toISOString() }).eq('id', t.id); try { if (await mailTache(db, t, 'retard')) bilan.retard++; } catch (e) { console.error(e); } }
    const { data: rs } = await db.from('bureau_reunions').select('*').eq('statut', 'prevue').is('rappel_at', null).gte('quand', new Date().toISOString()).lte('quand', new Date(Date.now() + 2 * 86400000).toISOString());
    for (const r of (rs || []).filter((r) => jourParis(new Date(r.quand)) === demain)) {
      const { data: lock } = await db.from('bureau_reunions').update({ rappel_at: new Date().toISOString() }).eq('id', r.id).is('rappel_at', null).select('id');
      if (lock?.length) { await mailReunion(db, r, 'rappel', seulement); bilan.reunions++; }
    }
    return json(req, 200, { ok: true, ...bilan });
  }

  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const par = [me.profile?.prenom, me.profile?.nom].filter(Boolean).join(' ');

  if (b.action === 'tache') {
    const { data: t } = await db.from('bureau_taches').select('*').eq('id', b.id).maybeSingle();
    if (!t || !t.assigne_a || t.assigne_a === me.user.id) return json(req, 200, { ok: true, envoye: false });
    try { return json(req, 200, { ok: true, envoye: await mailTache(db, t, 'nouvelle', par) }); } catch { return json(req, 200, { ok: true, envoye: false }); }
  }
  if (b.action === 'convoquer') {
    const { data: r } = await db.from('bureau_reunions').select('*').eq('id', b.id).maybeSingle();
    if (!r) return json(req, 404, { error: 'Réunion introuvable.' });
    const n = await mailReunion(db, r, 'convocation');
    await db.from('bureau_reunions').update({ convoque_at: new Date().toISOString() }).eq('id', r.id);
    await db.from('journal').insert({ acteur: me.user.id, acteur_nom: par, categorie: 'Réunion du bureau', resume: `a convoqué le bureau à la réunion « ${r.titre} » (${n} emails)` });
    return json(req, 200, { ok: true, emails: n });
  }
  return json(req, 400, { error: 'Action inconnue.' });
});

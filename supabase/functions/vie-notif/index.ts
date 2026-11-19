import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest } from '../_shared/lib.ts';
import { pushUtilisateurs, pushTous } from '../_shared/push.ts';

// Notifications : nouveau sondage, nouvelle sortie, sortie annulée (bureau) ; place libérée sur liste d'attente (tout membre, vérifié)
const quand = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
const emails = async (db: ReturnType<typeof admin>, ids: string[]) => {
  const { data } = await db.from('adhesions').select('user_id, email').in('user_id', ids);
  return new Map((data || []).map((x) => [x.user_id, x.email]));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré.' });
  const b = await readJson(req); const db = admin();
  const bureau = ['bureau', 'admin'].includes(me.profile?.role);

  if (b?.action === 'promotion') {
    const { data: i } = await db.from('sortie_inscrits').select('user_id, promu_at, sorties(id, titre, quand, lieu, autorisation)').eq('sortie', b.sortie).eq('user_id', b.user).eq('statut', 'inscrit').maybeSingle() as any;
    if (!i?.promu_at || Date.now() - new Date(i.promu_at).getTime() > 5 * 60000) return json(req, 200, { ok: true, rien: true });
    await db.from('sortie_inscrits').update({ promu_at: null }).eq('sortie', b.sortie).eq('user_id', b.user);
    const s = i.sorties; const to = (await emails(db, [b.user])).get(b.user);
    await pushUtilisateurs([b.user], { titre: 'Une place s\'est libérée !', texte: `Tu es inscrit·e à « ${s.titre} » (${quand(s.quand)}).`, url: `${SITE}/sorties` });
    if (to) await sendMail({ from: FROM, to, subject: `Une place s'est libérée : ${s.titre}`, html: layout({ title: 'Une place s\'est libérée pour toi', body: `<p>Tu étais sur liste d'attente pour <strong>${esc(s.titre)}</strong> : tu es maintenant inscrit·e.</p><p>${esc(quand(s.quand))}${s.lieu ? ` · ${esc(s.lieu)}` : ''}</p>${s.autorisation ? '<p><strong>N\'oublie pas l\'autorisation parentale</strong> : télécharge-la depuis ton espace, fais-la signer et rapporte-la au bureau.</p>' : ''}${button(`${SITE}/sorties`, 'Voir la sortie')}<p style="color:#555;font-size:14px;">Tu ne peux plus venir ? Désinscris-toi pour laisser ta place au suivant.</p>` }) });
    return json(req, 200, { ok: true });
  }
  if (!bureau) return json(req, 403, { error: 'Réservé au bureau.' });

  if (b?.action === 'sondage') {
    const { data: s } = await db.from('sondages').select('question').eq('id', b.id).maybeSingle();
    if (!s) return json(req, 404, { error: 'Sondage introuvable.' });
    const r = await pushTous({ titre: 'Nouveau sondage', texte: s.question, url: `${SITE}/sondages` });
    return json(req, 200, { ok: true, push: r.envoyes });
  }
  if (b?.action === 'sortie') {
    const { data: s } = await db.from('sorties').select('titre, quand, places').eq('id', b.id).maybeSingle();
    if (!s) return json(req, 404, { error: 'Sortie introuvable.' });
    const r = await pushTous({ titre: 'Nouvelle sortie : inscris-toi !', texte: `${s.titre} — ${quand(s.quand)}${s.places ? ` · ${s.places} places` : ''}`, url: `${SITE}/sorties` });
    return json(req, 200, { ok: true, push: r.envoyes });
  }
  if (b?.action === 'sortie-annulee') {
    const { data: s } = await db.from('sorties').select('titre, quand').eq('id', b.id).maybeSingle();
    const { data: ins } = await db.from('sortie_inscrits').select('user_id').eq('sortie', b.id);
    if (!s) return json(req, 404, { error: 'Sortie introuvable.' });
    const ids = (ins || []).map((x) => x.user_id); const m = await emails(db, ids);
    await pushUtilisateurs(ids, { titre: 'Sortie annulée', texte: `${s.titre}, prévue le ${quand(s.quand)}, est annulée.`, url: `${SITE}/sorties` });
    let n = 0;
    for (const id of ids) { const to = m.get(id); if (!to) continue; try { await sendMail({ from: FROM, to, subject: `Sortie annulée : ${s.titre}`, html: layout({ title: 'Sortie annulée', body: `<p>La sortie <strong>${esc(s.titre)}</strong>, prévue le ${esc(quand(s.quand))}, est annulée. Désolé pour ce changement.</p>${button(`${SITE}/sorties`, 'Voir les autres sorties')}` }) }); n++; } catch (e) { console.error(e); } }
    return json(req, 200, { ok: true, envoyes: n });
  }
  return json(req, 400, { error: 'Action inconnue' });
});

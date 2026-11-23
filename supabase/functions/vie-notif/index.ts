import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest } from '../_shared/lib.ts';
import { pushUtilisateurs, pushTous } from '../_shared/push.ts';

// Notifications : nouveau sondage, nouvelle sortie, sortie annulée (bureau) ; place libérée sur liste d'attente (tout membre, vérifié)
const quand = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
const emails = async (db: ReturnType<typeof admin>, ids: string[]) => {
  const { data } = await db.from('adhesions').select('user_id, email').in('user_id', ids);
  return new Map((data || []).map((x) => [x.user_id, x.email]));
};

/** Membres actifs (compte, non suspendus) avec leur email et prénom. */
async function membres(db: ReturnType<typeof admin>) {
  const [{ data: adh }, { data: profs }] = await Promise.all([
    db.from('adhesions').select('user_id, email').not('user_id', 'is', null),
    db.from('profiles').select('id, prenom, banni'),
  ]);
  const p = new Map((profs || []).map((x) => [x.id, x]));
  const vus = new Set<string>(); const out: { email: string; prenom: string }[] = [];
  for (const a of adh || []) {
    const pr = p.get(a.user_id); if (!pr || pr.banni || !a.email) continue;
    const k = a.email.toLowerCase(); if (vus.has(k)) continue; vus.add(k);
    out.push({ email: a.email, prenom: pr.prenom || '' });
  }
  return out;
}

/** Email « nouveau sondage ». */
function mailSondage(prenom: string, s: { question: string; options: string[]; multiple: boolean; fin: string | null }) {
  const opts = (s.options || []).map((o) => `<li style="margin:0 0 6px;">${esc(o)}</li>`).join('');
  return {
    sujet: `Nouveau sondage : ${s.question.length > 70 ? s.question.slice(0, 67) + '…' : s.question}`,
    html: layout({ title: `${prenom ? esc(prenom) + ', ton' : 'Ton'} avis compte`, body:
      `<p style="margin:0 0 16px;">Le bureau du Parlement JPV vient de publier un nouveau sondage et a besoin de la réponse de chaque membre.</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="border:2px solid #0f1f4b;border-left:6px solid #d62839;border-radius:8px;padding:16px 18px;">
         <div style="font-size:12px;font-weight:700;color:#d62839;margin-bottom:6px;">La question</div>
         <div style="font-size:18px;font-weight:800;line-height:1.3;color:#0f1f4b;margin-bottom:12px;">${esc(s.question)}</div>
         <div style="font-size:13px;color:#5d6477;margin-bottom:6px;">${s.multiple ? 'Plusieurs réponses possibles :' : 'Une seule réponse possible :'}</div>
         <ul style="margin:0;padding-left:20px;font-size:15px;color:#24304f;">${opts}</ul>
       </td></tr></table>
       <p style="margin:0 0 6px;">Répondre prend <strong>moins d'une minute</strong>, directement depuis ton espace membre. Les réponses sont anonymes.</p>
       ${s.fin ? `<p style="margin:0 0 6px;">Le sondage est ouvert jusqu'au <strong>${esc(quand(s.fin))}</strong>.</p>` : ''}
       ${button(`${SITE}/sondages`, 'Je réponds au sondage')}
       <p style="color:#555;font-size:14px;">Merci pour ta participation,<br><strong>Le bureau du Parlement JPV</strong></p>` }),
  };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function envoyerSondage(db: ReturnType<typeof admin>, id: string, dest: { email: string; prenom: string }[]) {
  const { data: s } = await db.from('sondages').select('question, options, multiple, fin').eq('id', id).maybeSingle();
  if (!s) return null;
  let ok = 0, ko = 0;
  for (const d of dest) { const m = mailSondage(d.prenom, s as any); try { await sendMail({ from: FROM, to: d.email, subject: m.sujet, html: m.html }); ok++; } catch (e) { console.error(e); ko++; } await pause(400); }
  return { question: s.question, ok, ko };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const secret = Deno.env.get('BACKUP_SECRET');
  if (secret && req.headers.get('x-sauvegarde') === secret) {
    const b0 = await readJson(req); const db0 = admin();
    if (b0?.action === 'sondage-mail') {
      const dest = b0.test ? [{ email: 'gustave.jeannin14@gmail.com', prenom: 'Gustave' }] : b0.confirme === true ? await membres(db0) : null;
      if (!dest) return json(req, 400, { error: 'confirme requis' });
      return json(req, 200, { ok: true, test: !!b0.test, ...(await envoyerSondage(db0, b0.id, dest)) });
    }
    return json(req, 400, { error: 'Action inconnue' });
  }
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
    const m = await envoyerSondage(db, b.id, await membres(db));
    return json(req, 200, { ok: true, push: r.envoyes, emails: m?.ok || 0 });
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

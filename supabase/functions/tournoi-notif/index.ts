import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest } from '../_shared/lib.ts';
import { pushUtilisateurs, pushTous } from '../_shared/push.ts';

// Notifications du tournoi d'éloquence (déclenchées par le bureau) :
//  ouverture : alerte à tous les membres · tirage : chaque participant découvre son premier duel
//  match     : les deux orateurs reçoivent sujet, date et lieu · champion : annonce à tous
const nomTour = (tour: number, nb: number) => (({ 2: 'la finale', 4: 'les demi-finales', 8: 'les quarts de finale', 16: 'les huitièmes de finale', 32: 'les seizièmes de finale' } as Record<number, string>)[2 ** (nb - tour + 1)] || `le tour ${tour}`);
const quand = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req);
  const db = admin();
  const url = `${SITE}/tournoi`;
  const emailDe = async (ids: string[]) => {
    const { data } = await db.from('adhesions').select('user_id, email').in('user_id', ids);
    const m = new Map((data || []).map((x) => [x.user_id, x.email]));
    for (const id of ids) if (!m.has(id)) { const { data: u } = await db.auth.admin.getUserById(id); if (u?.user?.email) m.set(id, u.user.email); }
    return m;
  };
  const noms = async (ids: string[]) => { const { data } = await db.from('profiles').select('id, prenom, nom').in('id', ids); return new Map((data || []).map((p) => [p.id, p])); };

  if (b?.action === 'ouverture' || b?.action === 'champion') {
    const { data: t } = await db.from('tournois').select('id, nom, fin_inscriptions, champion').eq('id', b.tournoi).maybeSingle();
    if (!t) return json(req, 404, { error: 'Tournoi introuvable.' });
    if (b.action === 'ouverture') {
      const r = await pushTous({ titre: 'Tournoi d\'éloquence : inscris-toi !', texte: `${t.nom}${t.fin_inscriptions ? ` — inscriptions jusqu'au ${quand(t.fin_inscriptions)}` : ''}`, url, tag: `tournoi-${t.id}` });
      return json(req, 200, { ok: true, push: r.envoyes });
    }
    if (!t.champion) return json(req, 400, { error: 'Pas encore de champion.' });
    const p = (await noms([t.champion])).get(t.champion);
    const r = await pushTous({ titre: `${p?.prenom} ${p?.nom?.[0]}. remporte le tournoi !`, texte: `Champion·ne de « ${t.nom} ». Bravo !`, url, tag: `tournoi-${t.id}` });
    const mail = (await emailDe([t.champion])).get(t.champion);
    if (mail) await sendMail({ from: FROM, to: mail, subject: `Tu as remporté « ${t.nom} » !`, html: layout({ title: `Bravo ${p?.prenom}, tu es champion·ne !`, body: `<p>Tu as remporté le tournoi d'éloquence <strong>${esc(t.nom)}</strong>. Le titre apparaît désormais sur ton profil d'orateur.</p>${button(`${SITE}/profil`, 'Voir mon profil')}` }) });
    return json(req, 200, { ok: true, push: r.envoyes });
  }

  // Duels : tous ceux du premier tour (tirage) ou un seul (match)
  let matchs: any[] = [];
  if (b?.action === 'tirage') ({ data: matchs } = await db.from('tournoi_matchs').select('*, tournois(nom)').eq('tournoi', b.tournoi).eq('tour', 1) as any);
  else if (b?.action === 'match') ({ data: matchs } = await db.from('tournoi_matchs').select('*, tournois(nom)').eq('id', b.match) as any);
  else return json(req, 400, { error: 'Action inconnue' });
  if (!matchs?.length) return json(req, 404, { error: 'Duel introuvable.' });
  const { data: tours } = await db.from('tournoi_matchs').select('tour').eq('tournoi', matchs[0].tournoi).order('tour', { ascending: false }).limit(1);
  const nb = tours?.[0]?.tour || 1;
  const ids = [...new Set(matchs.flatMap((m) => [m.a, m.b]).filter(Boolean))] as string[];
  const [mails, n] = await Promise.all([emailDe(ids), noms(ids)]);
  let envoyes = 0;
  for (const m of matchs) {
    for (const [moi, adv] of [[m.a, m.b], [m.b, m.a]] as [string | null, string | null][]) {
      if (!moi) continue;
      const p = n.get(moi), q = adv ? n.get(adv) : null, to = mails.get(moi);
      const titre = !adv ? 'Qualifié d\'office pour le tour suivant' : `Ton duel pour ${nomTour(m.tour, nb)}`;
      const texte = !adv ? `Le tirage t'exempte du premier tour de « ${m.tournois.nom} ».` : `Contre ${q?.prenom} ${q?.nom?.[0]}.${m.sujet ? ` Sujet : « ${m.sujet} »` : ''}${m.quand ? ` — ${quand(m.quand)}` : ''}`;
      await pushUtilisateurs([moi], { titre, texte, url, tag: `duel-${m.id}` });
      if (!to) continue;
      try {
        await sendMail({ from: FROM, to, subject: `Tournoi d'éloquence : ${titre.toLowerCase()}`, html: layout({ title: `${p?.prenom}, ${!adv ? 'tu passes directement au tour suivant' : `ton adversaire : ${q?.prenom} ${q?.nom?.[0]}.`}`, body:
          `<p>Tournoi <strong>${esc(m.tournois.nom)}</strong>${adv ? `, ${esc(nomTour(m.tour, nb))}` : ''}.</p>
           ${!adv ? '<p>Le tirage au sort t\'exempte du premier tour : rendez-vous au suivant.</p>' : `
           <table style="border-collapse:collapse;font-size:15px;">
             <tr><td style="padding:4px 14px 4px 0;color:#555;">Adversaire</td><td><strong>${esc(q?.prenom)} ${esc(q?.nom?.[0])}.</strong></td></tr>
             <tr><td style="padding:4px 14px 4px 0;color:#555;">Sujet</td><td>${m.sujet ? `« ${esc(m.sujet)} »` : 'annoncé prochainement par le bureau'}</td></tr>
             <tr><td style="padding:4px 14px 4px 0;color:#555;">Quand</td><td>${m.quand ? esc(quand(m.quand)) : 'date à venir'}</td></tr>
             ${m.lieu ? `<tr><td style="padding:4px 14px 4px 0;color:#555;">Où</td><td>${esc(m.lieu)}</td></tr>` : ''}
           </table>`}
           ${button(url, 'Voir le tableau du tournoi')}` }) });
        envoyes++;
      } catch (e) { console.error(e); }
    }
  }
  return json(req, 200, { ok: true, envoyes });
});

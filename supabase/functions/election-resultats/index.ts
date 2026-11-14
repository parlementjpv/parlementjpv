import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest } from '../_shared/lib.ts';

// Envoie les résultats d'une élection publiée à chaque membre qui a voté (une seule fois par élection).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req); if (!b?.id) return json(req, 400, { error: 'Requête invalide' });
  const db = admin();
  const { data: lock } = await db.from('elections').update({ resultats_envoyes_at: new Date().toISOString() })
    .eq('id', b.id).eq('publiee', true).is('resultats_envoyes_at', null).select('id, titre, poste, blancs');
  const e = lock?.[0];
  if (!e) return json(req, 200, { ok: true, deja: true, envoyes: 0 });

  const [{ data: cands }, { data: votants }] = await Promise.all([
    db.from('election_candidats').select('nom, voix').eq('election_id', e.id).order('voix', { ascending: false }),
    db.from('election_votants').select('user_id').eq('election_id', e.id),
  ]);
  const total = (cands || []).reduce((a, c) => a + c.voix, 0) + e.blancs;
  const max = Math.max(0, ...(cands || []).map((c) => c.voix));
  const gagnants = (cands || []).filter((c) => c.voix === max && max > 0);
  const titre = gagnants.length === 1 ? `${gagnants[0].nom} est élu·e${e.poste ? ` ${e.poste.toLowerCase()}` : ''}` : 'Égalité : le bureau organisera un second tour';
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const tableau = `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:15px;">
    ${(cands || []).map((c) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e9ebf0;font-weight:${c.voix === max && max > 0 ? 800 : 400};">${esc(c.nom)}</td><td style="padding:8px 0;border-bottom:1px solid #e9ebf0;text-align:right;white-space:nowrap;"><strong>${c.voix}</strong> voix · ${pct(c.voix)} %</td></tr>`).join('')}
    <tr><td style="padding:8px 0;color:#555;">Votes blancs</td><td style="padding:8px 0;text-align:right;color:#555;">${e.blancs} · ${pct(e.blancs)} %</td></tr></table>`;

  // Adresses des votants (via leur adhésion), sans jamais savoir pour qui ils ont voté
  const ids = (votants || []).map((v) => v.user_id);
  const { data: adhs } = ids.length ? await db.from('adhesions').select('user_id, prenom, email').in('user_id', ids) : { data: [] };
  let envoyes = 0;
  for (const a of adhs || []) {
    try {
      await sendMail({ from: FROM, to: a.email, subject: `Résultats : ${e.titre}`,
        html: layout({ title: titre, body: `<p>${esc(a.prenom)}, merci d'avoir voté ! Voici les résultats de <strong>${esc(e.titre)}</strong> (${total} votant${total > 1 ? 's' : ''}) :</p>${tableau}
          ${button(`${SITE}/elections`, 'Voir les résultats')}
          <p style="color:#555;font-size:13px;">Tu reçois cet email parce que tu as participé à ce vote. Ton choix est resté secret : personne ne peut savoir pour qui tu as voté.</p>` }) });
      envoyes++;
    } catch (err) { console.error(err); }
  }
  return json(req, 200, { ok: true, envoyes });
});

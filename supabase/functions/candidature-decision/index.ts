import { admin, sendMail, json, userFromRequest, esc, layout, button, SITE, cors, readJson, journal } from '../_shared/lib.ts';

const STATUTS = ['nouvelle', 'en_cours', 'acceptee', 'refusee'];

/** Le bureau change le statut d'une candidature. Acceptée ou refusée => email automatique au candidat. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Accès réservé au bureau.' });
  const b = await readJson(req); if (!b) return json(req, 400, { error: 'Requête invalide' });
  if (!STATUTS.includes(b.statut)) return json(req, 400, { error: 'Statut invalide.' });
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : undefined;

  const db = admin();
  const decided = b.statut === 'acceptee' || b.statut === 'refusee';
  const patch: Record<string, unknown> = { statut: b.statut, decided_at: decided ? new Date().toISOString() : null };
  if (note !== undefined) patch.note_bureau = note || null;
  const { data: c, error } = await db.from('candidatures').update(patch).eq('id', b.id).select('*').maybeSingle();
  if (error || !c) return json(req, 404, { error: 'Candidature introuvable.' });
  const LIB: Record<string, string> = { acceptee: 'accepté', refusee: 'refusé', en_cours: 'mis en cours', nouvelle: 'rouvert' };
  await journal(me.user.id, 'Membres', `a ${LIB[b.statut] || b.statut} la candidature de ${c.prenom} ${c.nom}${c.poste ? ` (${c.poste})` : ''}`);
  if (!decided) return json(req, 200, { ok: true, emailed: false });

  const poste = c.type === 'bureau' ? (c.poste && c.poste !== 'Peu importe' ? `au poste de ${c.poste}` : 'au bureau') : "comme membre de l'instance";
  const mot = c.note_bureau ? `<p style="border-left:4px solid #d62839;padding-left:12px;"><strong>Message du bureau :</strong><br>${esc(c.note_bureau).replace(/\n/g, '<br>')}</p>` : '';
  const html = c.statut === 'acceptee'
    ? layout({ title: `Félicitations ${c.prenom} !`, body: `<p>Ta candidature ${esc(poste)} au Parlement JPV a été <strong>acceptée</strong>.</p>${mot}<p>Le bureau reviendra vers toi très vite pour la suite. Tu peux suivre ta candidature depuis ton espace.</p>${button(`${SITE}/compte`, 'Mon espace')}` })
    : layout({ title: `Merci ${c.prenom}`, body: `<p>Nous avons étudié ta candidature ${esc(poste)} avec attention. Elle n'a pas été retenue cette fois-ci.</p>${mot}<p>Tu restes membre de l'instance : les débats, conférences et ateliers te sont ouverts, et d'autres occasions de t'engager viendront.</p>${button(`${SITE}/evenement`, 'Voir les prochains événements')}` });
  try {
    await sendMail({ to: c.email, subject: c.statut === 'acceptee' ? 'Ta candidature est acceptée — Parlement JPV' : 'Réponse à ta candidature — Parlement JPV', html });
  } catch (e) {
    console.error('mail', e);
    return json(req, 200, { ok: true, emailed: false, warning: "Statut enregistré, mais l'email n'a pas pu partir." });
  }
  return json(req, 200, { ok: true, emailed: true });
});

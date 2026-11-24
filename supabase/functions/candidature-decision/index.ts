import { admin, sendMail, json, userFromRequest, esc, layout, button, SITE, cors, readJson, journal } from '../_shared/lib.ts';

const STATUTS = ['nouvelle', 'en_cours', 'acceptee', 'refusee'];

/** Le bureau répond à une candidature (statut ou message) => email automatique au candidat. */
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
  const { data: avant } = await db.from('candidatures').select('statut, note_bureau').eq('id', b.id).maybeSingle();
  if (!avant) return json(req, 404, { error: 'Candidature introuvable.' });
  const decided = b.statut === 'acceptee' || b.statut === 'refusee';
  const patch: Record<string, unknown> = { statut: b.statut, decided_at: decided ? new Date().toISOString() : null };
  if (note !== undefined) patch.note_bureau = note || null;
  const { data: c, error } = await db.from('candidatures').update(patch).eq('id', b.id).select('*').maybeSingle();
  if (error || !c) return json(req, 404, { error: 'Candidature introuvable.' });
  const LIB: Record<string, string> = { acceptee: 'accepté', refusee: 'refusé', en_cours: 'mis en cours', nouvelle: 'rouvert' };
  await journal(me.user.id, 'Membres', `a ${LIB[b.statut] || b.statut} la candidature de ${c.prenom} ${c.nom}${c.poste ? ` (${c.poste})` : ''}`);

  // Email au candidat dès que le bureau répond : changement de statut (en cours, acceptée, refusée) ou nouveau message.
  const statutChange = avant.statut !== c.statut && c.statut !== 'nouvelle';
  const messageChange = (c.note_bureau || '') !== (avant.note_bureau || '') && !!c.note_bureau;
  if (!statutChange && !messageChange) return json(req, 200, { ok: true, emailed: false });

  const objet = c.type === 'bureau' ? (c.poste && c.poste !== 'Peu importe' ? `au poste de ${c.poste}` : 'au bureau') : "au Parlement JPV";
  const html = layout({ title: `${esc(c.prenom)}, le bureau a répondu à ta candidature`, body:
    `<p>Le bureau du Parlement JPV a répondu à ta candidature ${esc(objet)}.</p>
     <p>Pour découvrir sa réponse${messageChange ? ' et le message qu\'il t\'a laissé' : ''}, connecte-toi et consulte la rubrique <strong>« Ma candidature »</strong> dans ton espace membre.</p>
     ${button(`${SITE}/compte#cand`, 'Consulter mon espace')}
     <p style="color:#555;font-size:14px;">Une question ? Réponds simplement à cet email.<br>Le bureau du Parlement JPV</p>` });
  try {
    await sendMail({ to: c.email, subject: 'Le bureau a répondu à ta candidature — Parlement JPV', html });
  } catch (e) {
    console.error('mail', e);
    return json(req, 200, { ok: true, emailed: false, warning: "Réponse enregistrée, mais l'email n'a pas pu partir." });
  }
  return json(req, 200, { ok: true, emailed: true });
});

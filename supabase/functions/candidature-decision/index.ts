import { admin, sendMail, json, userFromRequest, esc, layout, button, SITE, cors, readJson, journal } from '../_shared/lib.ts';

/** Email : le bureau pense que la candidature a été rédigée par une IA et propose de la réécrire. */
function mailIA(prenom: string, objet: string) {
  return { sujet: 'Ta candidature au Parlement JPV — à réécrire avec tes propres mots', html: layout({ title: `${esc(prenom)}, une demande du bureau au sujet de ta candidature`, body:
    `<p>Merci pour ta candidature ${esc(objet)}.</p>
     <p>Après lecture attentive, le bureau a relevé <strong>de nombreux indices laissant penser que ta candidature a été rédigée en grande partie par une intelligence artificielle</strong> (ChatGPT ou un outil similaire).</p>
     <p>Ce que le bureau cherche à connaître, c'est <strong>toi</strong> : ta motivation, tes idées, ta façon de t'exprimer. Une candidature écrite par une IA ne nous permet pas de l'évaluer, et ne te rend pas justice.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr><td style="border-left:4px solid #d62839;background:#f4f5f8;border-radius:6px;padding:14px 16px;font-size:15px;line-height:1.55;">
       <strong>Nous te proposons de modifier ta candidature</strong> et de la réécrire avec tes propres mots. Elle n'a pas besoin d'être parfaite ni longue : quelques lignes sincères et concrètes valent bien mieux qu'un texte impeccable.</td></tr></table>
     <p>Pour la modifier : connecte-toi, ouvre la page Candidature, puis touche <strong>« Modifier ma candidature »</strong>.</p>
     ${button(`${SITE}/candidature`, 'Modifier ma candidature')}
     <p>Si tu as rédigé ce texte toi-même, réponds simplement à cet email : nous en parlerons volontiers, et un court échange oral avec le bureau fait de toute façon partie de la sélection.</p>
     <p style="color:#555;font-size:14px;">Le bureau du Parlement JPV</p>` }) };
}


const STATUTS = ['nouvelle', 'en_cours', 'acceptee', 'refusee'];

/** Le bureau répond à une candidature (statut ou message) => email automatique au candidat. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const secret = Deno.env.get('BACKUP_SECRET');
  if (secret && req.headers.get('x-sauvegarde') === secret) {
    const t = await readJson(req);
    if (t?.action === 'ia-test') { const m = mailIA('Gustave', 'au poste de Responsable Débat'); await sendMail({ to: 'gustave.jeannin14@gmail.com', subject: '[TEST] ' + m.sujet, html: m.html }); return json(req, 200, { ok: true, test: true }); }
    return json(req, 400, { error: 'Action inconnue' });
  }
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Accès réservé au bureau.' });
  const b = await readJson(req); if (!b) return json(req, 400, { error: 'Requête invalide' });
  if (b.action === 'ia') {
    const db1 = admin();
    const note = 'Le bureau pense que ta candidature a été rédigée en grande partie par une IA. Tu peux la modifier et la réécrire avec tes propres mots depuis la page Candidature.';
    const { data: c1 } = await db1.from('candidatures').update({ statut: 'en_cours', note_bureau: note, decided_at: null }).eq('id', b.id).in('statut', ['nouvelle', 'en_cours']).select('*').maybeSingle();
    if (!c1) return json(req, 404, { error: 'Candidature introuvable ou déjà décidée.' });
    const objet = c1.type === 'bureau' ? (c1.poste && c1.poste !== 'Peu importe' ? `au poste de ${c1.poste}` : 'au bureau') : 'au Parlement JPV';
    const m = mailIA(c1.prenom, objet);
    await journal(me.user.id, 'Membres', `a demandé à ${c1.prenom} ${c1.nom} de réécrire sa candidature (rédaction par IA)`);
    try { await sendMail({ to: c1.email, subject: m.sujet, html: m.html }); } catch (e) { console.error(e); return json(req, 200, { ok: true, emailed: false, warning: "Enregistré, mais l'email n'a pas pu partir." }); }
    return json(req, 200, { ok: true, emailed: true });
  }
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

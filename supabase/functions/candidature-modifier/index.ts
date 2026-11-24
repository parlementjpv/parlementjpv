import { admin, sendMail, json, userFromRequest, esc, layout, button, SITE, FROM, BUREAU_EMAIL, cors, readJson } from '../_shared/lib.ts';

/** Le candidat modifie sa candidature tant que le bureau n'a pas décidé. Le bureau est prévenu par email. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  const b = await readJson(req);
  const motivation = String(b?.motivation || '').trim().slice(0, 5000);
  if (motivation.length < 80) return json(req, 400, { error: 'Ta motivation doit faire au moins quelques lignes (80 caractères).' });
  const db = admin();
  const { data: c } = await db.from('candidatures').select('id, statut, type, poste, prenom, nom, classe').eq('id', b.id).eq('user_id', me.user.id).maybeSingle();
  if (!c) return json(req, 404, { error: 'Candidature introuvable.' });
  if (!['nouvelle', 'en_cours'].includes(c.statut)) return json(req, 400, { error: 'Le bureau a déjà rendu sa décision : la candidature ne peut plus être modifiée.' });
  const patch: Record<string, unknown> = { motivation, experience: String(b.experience || '').trim().slice(0, 3000) || null, disponibilites: String(b.disponibilites || '').trim().slice(0, 300) || null };
  if (c.type === 'bureau' && typeof b.poste === 'string' && b.poste) patch.poste = b.poste.slice(0, 80);
  const { error } = await db.from('candidatures').update(patch).eq('id', c.id);
  if (error) return json(req, 500, { error: 'La modification n\'a pas pu être enregistrée.' });
  try {
    await sendMail({ from: FROM, to: BUREAU_EMAIL, subject: `[Candidature modifiée] ${c.prenom} ${c.nom} (${c.classe})`, html: layout({ title: 'Candidature modifiée', body:
      `<p><strong>${esc(c.prenom)} ${esc(c.nom)}</strong> (${esc(c.classe)}) a modifié sa candidature${c.type === 'bureau' ? ` au poste de ${esc(String(patch.poste || c.poste || 'bureau'))}` : ''}.</p><h3>Nouvelle motivation</h3><p style="white-space:pre-wrap;">${esc(motivation)}</p>${button(`${SITE}/bureau`, "Ouvrir l'espace bureau")}` }) });
  } catch (e) { console.error(e); }
  return json(req, 200, { ok: true });
});

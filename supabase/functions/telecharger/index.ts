import { admin, json, cors, userFromRequest, readJson, journal } from '../_shared/lib.ts';
import { genererDocument } from '../_shared/documents.ts';

// Rubrique « Téléchargements » : documents PDF du bureau, réservés aux administrateurs.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  if (me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = await readJson(req) || {};
  const auteur = [me.profile?.prenom, me.profile?.nom].filter(Boolean).join(' ') || 'un administrateur';
  const r = await genererDocument(admin(), b, auteur);
  if ('error' in r) return json(req, r.status, { error: r.error });
  await journal(me.user.id, 'Téléchargements', `a téléchargé en PDF ${r.quoi}`);
  return new Response(r.pdf, { headers: { ...cors(req), 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${r.fichier}"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' } });
});

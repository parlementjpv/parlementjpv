import { json, cors, userFromRequest, readJson, journal } from '../_shared/lib.ts';
import { certificatPdf } from '../_shared/certificat.ts';

// Certificat de membre en PDF pour l'utilisateur connecté ; un admin peut obtenir celui de n'importe quel membre ({ user })
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  const b = await readJson(req);
  const autre = typeof b?.user === 'string' && b.user !== me.user.id ? b.user : null;
  if (autre && me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  if (autre && !/^[0-9a-f-]{36}$/i.test(autre)) return json(req, 400, { error: 'Requête invalide' });
  const c = await certificatPdf(autre || me.user.id);
  if (!c) return json(req, 403, { error: autre ? 'Ce compte est suspendu : pas de certificat.' : 'Certificat indisponible.' });
  if (autre) await journal(me.user.id, 'Membres', `a téléchargé le certificat de membre de ${c.prenom} (${c.nomFichier.replace('certificat-parlement-jpv-', '').replace('.pdf', '')})`);
  return new Response(c.pdf, { headers: { ...cors(req), 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${c.nomFichier}"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' } });
});

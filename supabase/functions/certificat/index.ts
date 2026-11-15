import { json, cors, userFromRequest } from '../_shared/lib.ts';
import { certificatPdf } from '../_shared/certificat.ts';

// Certificat de membre en PDF pour l'utilisateur connecté
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  const c = await certificatPdf(me.user.id);
  if (!c) return json(req, 403, { error: 'Certificat indisponible.' });
  return new Response(c.pdf, { headers: { ...cors(req), 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${c.nomFichier}"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' } });
});

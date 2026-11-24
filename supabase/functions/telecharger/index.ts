import { admin, json, cors, readJson } from '../_shared/lib.ts';
import { genererDocument } from '../_shared/documents.ts';

// Fabrication des PDF du bureau — appel interne uniquement (clé serveur), par la fonction archive-pdf.
// Aucun téléchargement direct depuis le site : les documents partent par email, dans un ZIP chiffré.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const secret = Deno.env.get('BACKUP_SECRET');
  if (!secret || req.headers.get('x-sauvegarde') !== secret) return json(req, 403, { error: 'Les documents ne se téléchargent plus directement : utilise « Envoyer par email ».' });
  const r = await genererDocument(admin(), (await readJson(req)) || {}, (req.headers.get('x-demandeur') ? decodeURIComponent(req.headers.get('x-demandeur')!) : "l'archive automatique"));
  if ('error' in r) return json(req, r.status, { error: r.error });
  return new Response(r.pdf, { headers: { 'Content-Type': 'application/pdf', 'X-Fichier': encodeURIComponent(r.fichier) } });
});

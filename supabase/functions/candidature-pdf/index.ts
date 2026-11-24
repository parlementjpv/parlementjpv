import { json, cors } from '../_shared/lib.ts';

// Ancien téléchargement direct du dossier de candidature : désactivé.
// Le dossier s'envoie désormais par email, dans un ZIP chiffré (fonction archive-pdf, type « candidature »).
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  return json(req, 410, { error: 'Les dossiers ne se téléchargent plus : utilise « PDF par email » dans l\'espace bureau.' });
});

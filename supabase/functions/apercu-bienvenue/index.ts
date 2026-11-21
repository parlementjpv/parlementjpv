import { certificatPdf } from '../_shared/certificat.ts';
import { sendMail, json, cors, FROM } from '../_shared/lib.ts';
import { varianteA, varianteB, varianteC } from './variantes.ts';
// TEMPORAIRE — aperçu des variantes de l'email de bienvenue. Destinataire unique verrouillé.
const SEUL = 'gustave.jeannin14@gmail.com';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const s = Deno.env.get('BACKUP_SECRET');
  if (!s || req.headers.get('x-sauvegarde') !== s) return json(req, 401, { error: 'Non autorisé' });
  const c = await certificatPdf('d2353e1e-dc9d-4d1f-a182-837a9ac48537');
  const pj = c ? [{ filename: c.nomFichier, content: c.pdf, contentType: 'application/pdf' }] : undefined;
  const res: string[] = [];
  for (const [nom, v] of [['A', varianteA('Gustave')], ['B', varianteB('Gustave')], ['C', varianteC('Gustave')]] as const) {
    try { await sendMail({ from: FROM, to: SEUL, subject: `[Variante ${nom}] ${v.sujet}`, html: v.html, attachments: pj, brut: true } as any); res.push('OK ' + nom); } catch (e) { res.push('ERR ' + nom + ' ' + e); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return json(req, 200, { res });
});

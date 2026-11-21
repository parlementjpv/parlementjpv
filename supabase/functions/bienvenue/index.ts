import { certificatPdf } from '../_shared/certificat.ts';
import { emailBienvenue } from '../_shared/bienvenue-email.ts';
import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest, isEmail } from '../_shared/lib.ts';

// Guide d'installation de l'application, envoyé une seule fois à chaque nouveau membre (à sa première connexion).
// Le certificat de membre (PDF signé, avec QR code) est joint à l'email.
// Mode test (en-tête secret x-sauvegarde) : { a: email, prenom, user } envoie le guide (et le certificat de `user`) à cette adresse sans rien enregistrer.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const secret = Deno.env.get('BACKUP_SECRET');
  if (secret && req.headers.get('x-sauvegarde') === secret) {
    const b = await readJson(req);
    if (!isEmail(b?.a)) return json(req, 400, { error: 'Adresse invalide' });
    const c = b.user ? await certificatPdf(b.user) : null;
    await sendMail({ from: FROM, to: b.a, subject: emailBienvenue(b.prenom || '').sujet, html: emailBienvenue(b.prenom || '').html,
      attachments: c ? [{ filename: c.nomFichier, content: c.pdf, contentType: 'application/pdf' }] : undefined });
    return json(req, 200, { ok: true, test: true });
  }
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré.' });
  const db = admin();
  const { data: lock } = await db.from('profiles').update({ guide_envoye_at: new Date().toISOString() }).eq('id', me.user.id).is('guide_envoye_at', null).select('prenom');
  if (!lock?.length || !me.user.email) return json(req, 200, { ok: true, deja: true });
  try {
    const c = await certificatPdf(me.user.id);
    await sendMail({ from: FROM, to: me.user.email, subject: emailBienvenue(lock[0].prenom || '').sujet, html: emailBienvenue(lock[0].prenom || '').html,
      attachments: c ? [{ filename: c.nomFichier, content: c.pdf, contentType: 'application/pdf' }] : undefined });
  } catch (e) {
    console.error(e);
    await db.from('profiles').update({ guide_envoye_at: null }).eq('id', me.user.id);
    return json(req, 500, { error: 'Envoi impossible' });
  }
  return json(req, 200, { ok: true, envoye: true });
});

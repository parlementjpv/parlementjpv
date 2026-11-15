import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest, isEmail } from '../_shared/lib.ts';

// Guide d'installation de l'application, envoyé une seule fois à chaque nouveau membre (à sa première connexion).
// Mode test (en-tête secret x-sauvegarde) : { a: email, prenom } envoie le guide à cette adresse sans rien enregistrer.
function guide(prenom: string) {
  const etape = (n: number, t: string) => `<tr><td style="vertical-align:top;padding:6px 12px 6px 0;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#0f1f4b;color:#fff;font-weight:700;">${n}</span></td><td style="padding:6px 0;">${t}</td></tr>`;
  const bloc = (titre: string, etapes: string[]) => `<h3 style="margin:24px 0 6px;">${titre}</h3><table style="border-collapse:collapse;font-size:15px;">${etapes.map((t, i) => etape(i + 1, t)).join('')}</table>`;
  return layout({ title: `Bienvenue ${prenom} ! Installe l'app du Parlement`, body:
    `<p>Ton compte est actif. Pour ne rien rater (nouvelles séances, rappel la veille, votes), installe l'application Parlement JPV sur ton téléphone : elle s'ouvre directement sur ton espace et t'envoie des notifications. C'est gratuit et ça prend 30 secondes.</p>
     ${bloc('Sur iPhone (Safari)', [
       `Ouvre <a href="${SITE}/application">parlementjpv.github.io/parlementjpv/application</a> <strong>dans Safari</strong>.`,
       'Touche le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut).',
       'Choisis <strong>« Sur l\'écran d\'accueil »</strong>, puis <strong>Ajouter</strong>.',
       'Ouvre l\'app Parlement JPV depuis ton écran d\'accueil, connecte-toi et touche <strong>« Activer les notifications »</strong>.',
     ])}
     ${bloc('Sur Android (Chrome)', [
       `Ouvre <a href="${SITE}/application">la page d'installation</a> dans Chrome.`,
       'Touche <strong>« Installer l\'application »</strong> (ou le menu ⋮ puis <strong>« Installer l\'application »</strong>).',
       'Ouvre l\'app, connecte-toi et touche <strong>« Activer les notifications »</strong>.',
     ])}
     ${button(`${SITE}/application`, 'Installer l\'application')}
     <p>Dans ton espace, tu peux aussi télécharger ton <strong>certificat de membre</strong> à tout moment.</p>
     <p style="color:#555;font-size:13px;">Sur iPhone, les notifications ne fonctionnent que depuis l'app ajoutée à l'écran d'accueil (iOS 16.4 ou plus récent). Tu continueras de toute façon à recevoir les emails importants.</p>` });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const secret = Deno.env.get('BACKUP_SECRET');
  if (secret && req.headers.get('x-sauvegarde') === secret) {
    const b = await readJson(req);
    if (!isEmail(b?.a)) return json(req, 400, { error: 'Adresse invalide' });
    await sendMail({ from: FROM, to: b.a, subject: 'Bienvenue au Parlement JPV : installe l\'application', html: guide(b.prenom || 'à toi') });
    return json(req, 200, { ok: true, test: true });
  }
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré.' });
  const db = admin();
  const { data: lock } = await db.from('profiles').update({ guide_envoye_at: new Date().toISOString() }).eq('id', me.user.id).is('guide_envoye_at', null).select('prenom');
  if (!lock?.length || !me.user.email) return json(req, 200, { ok: true, deja: true });
  try {
    await sendMail({ from: FROM, to: me.user.email, subject: 'Bienvenue au Parlement JPV : installe l\'application', html: guide(lock[0].prenom || '') });
  } catch (e) {
    console.error(e);
    await db.from('profiles').update({ guide_envoye_at: null }).eq('id', me.user.id);
    return json(req, 500, { error: 'Envoi impossible' });
  }
  return json(req, 200, { ok: true, envoye: true });
});

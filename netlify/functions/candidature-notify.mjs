import { admin, resend, json, userFromRequest, esc, layout, button, SITE, FROM, BUREAU_EMAIL } from './_lib.mjs';

/** Après dépôt d'une candidature (insérée côté client sous RLS), prévient le bureau et accuse réception au candidat. */
export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(401, { error: 'Connexion requise.' });
  let b; try { b = await req.json(); } catch { return json(400, { error: 'Requête invalide' }); }
  const { data: c } = await admin().from('candidatures').select('*').eq('id', b.id).eq('user_id', me.user.id).maybeSingle();
  if (!c) return json(404, { error: 'Candidature introuvable.' });
  const r = resend();
  const typeLabel = { membre: 'Membre', mun: 'Délégué·e JPV MUN', bureau: 'Bureau' }[c.type] || c.type;
  try {
    await r.emails.send({
      from: FROM, to: BUREAU_EMAIL, replyTo: c.email, subject: `[Candidature ${typeLabel}] ${c.prenom} ${c.nom} (${c.classe})`,
      html: layout({ title: `Nouvelle candidature — ${typeLabel}`, body: `<p><strong>${esc(c.prenom)} ${esc(c.nom)}</strong> · ${esc(c.classe)} · ${esc(c.email)}</p><h3>Motivation</h3><p style="white-space:pre-wrap;">${esc(c.motivation)}</p>${c.experience ? `<h3>Expérience</h3><p style="white-space:pre-wrap;">${esc(c.experience)}</p>` : ''}${c.disponibilites ? `<h3>Disponibilités</h3><p>${esc(c.disponibilites)}</p>` : ''}${button(`${SITE}/bureau`, 'Ouvrir l’espace bureau')}` }),
    });
    await r.emails.send({
      from: FROM, to: c.email, subject: 'Candidature reçue — Parlement JPV',
      html: layout({ title: `Merci ${c.prenom} !`, body: `<p>Ta candidature (${esc(typeLabel)}) a bien été reçue. Le bureau l'étudie et te répond par email. Tu peux suivre son statut depuis ton espace membre.</p>${button(`${SITE}/compte`, 'Mon espace')}` }),
    });
  } catch (e) { console.error(e); }
  return json(200, { ok: true });
};

export const config = { path: '/api/candidature-notify' };

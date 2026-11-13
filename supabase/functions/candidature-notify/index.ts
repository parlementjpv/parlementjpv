import { admin, resend, json, userFromRequest, esc, layout, button, SITE, FROM, BUREAU_EMAIL, cors, readJson } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Connexion requise.' });
  const b = await readJson(req); if (!b) return json(req, 400, { error: 'Requête invalide' });
  const { data: c } = await admin().from('candidatures').select('*').eq('id', b.id).eq('user_id', me.user.id).maybeSingle();
  if (!c) return json(req, 404, { error: 'Candidature introuvable.' });
  const r = resend();
  const typeLabel = ({ membre: 'Membre', mun: 'Délégué·e JPV MUN', bureau: 'Bureau' } as Record<string, string>)[c.type] || c.type;
  try {
    await r.emails.send({
      from: FROM, to: BUREAU_EMAIL, replyTo: c.email, subject: `[Candidature ${typeLabel}] ${c.prenom} ${c.nom} (${c.classe})`,
      html: layout({ title: `Nouvelle candidature — ${typeLabel}`, body: `<p><strong>${esc(c.prenom)} ${esc(c.nom)}</strong> · ${esc(c.classe)} · ${esc(c.email)}</p><h3>Motivation</h3><p style="white-space:pre-wrap;">${esc(c.motivation)}</p>${c.experience ? `<h3>Expérience</h3><p style="white-space:pre-wrap;">${esc(c.experience)}</p>` : ''}${c.disponibilites ? `<h3>Disponibilités</h3><p>${esc(c.disponibilites)}</p>` : ''}${button(`${SITE}/bureau`, "Ouvrir l'espace bureau")}` }),
    });
    await r.emails.send({
      from: FROM, to: c.email, subject: 'Candidature reçue — Parlement JPV',
      html: layout({ title: `Merci ${c.prenom} !`, body: `<p>Ta candidature (${esc(typeLabel)}) a bien été reçue. Le bureau l'étudie et te répond par email. Tu peux suivre son statut depuis ton espace.</p>${button(`${SITE}/compte`, 'Mon espace')}` }),
    });
  } catch (e) { console.error(e); }
  return json(req, 200, { ok: true });
});

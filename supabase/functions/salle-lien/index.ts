import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson } from '../_shared/lib.ts';
import { fiche, lienEvenement, type Ev } from '../_shared/evenement.ts';

// Email de confirmation de présence : toutes les infos + lien privé de la salle du camp.
// N'écrit qu'à l'adresse inscrite pour ce jeton.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const b = await readJson(req);
  if (!b || typeof b.jeton !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.jeton)) return json(req, 400, { error: 'Requête invalide' });
  const db = admin();
  const { data: s } = await db.from('event_signups').select('id, prenom, email, camp, reponse, event_key, lien_envoye_at').eq('jeton', b.jeton).maybeSingle();
  if (!s || s.reponse !== 'oui') return json(req, 404, { error: 'Inscription introuvable.' });
  if (s.lien_envoye_at && Date.now() - new Date(s.lien_envoye_at).getTime() < 10 * 60 * 1000) return json(req, 200, { ok: true, deja: true });
  const { data: ev } = await db.from('events').select('*').eq('id', s.event_key).is('annule_at', null).maybeSingle<Ev>();
  if (!ev) return json(req, 404, { error: 'Événement introuvable.' });
  const salle = s.camp ? `<h3 style="margin-top:26px;">Préparer le débat avec ton camp</h3>
      <p>Ton camp dispose d'une salle de préparation privée : proposez et votez vos arguments, anticipez ce que dira l'autre camp, répartissez les prises de parole et discutez entre vous.</p>
      ${button(`${SITE}/salle?t=${b.jeton}`, 'Entrer dans la salle de mon camp')}
      <p style="color:#555;font-size:14px;">Ce lien est personnel : il t'identifie auprès de ton camp. Ne le partage pas — chaque participant reçoit le sien.</p>` : '';
  try {
    await sendMail({
      from: FROM, to: s.email, subject: `C'est confirmé : ${ev.title}`,
      html: layout({ title: `C'est noté, ${s.prenom} : on t'attend !`, body:
        `<p>Ta présence est confirmée. Voici tout ce qu'il faut savoir :</p>${fiche(ev, s.camp)}${salle}
         <p style="color:#555;font-size:14px;">Un empêchement ? Préviens-nous en changeant ta réponse sur <a href="${lienEvenement(ev)}">la page de l'événement</a>.</p>` }),
    });
    await db.from('event_signups').update({ lien_envoye_at: new Date().toISOString() }).eq('id', s.id);
  } catch (e) { console.error(e); return json(req, 500, { error: "L'email n'a pas pu être envoyé." }); }
  return json(req, 200, { ok: true });
});

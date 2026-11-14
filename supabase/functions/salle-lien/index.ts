import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson } from '../_shared/lib.ts';

// Envoie le lien privé de la salle de préparation, uniquement à l'adresse inscrite pour ce jeton.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const b = await readJson(req);
  if (!b || typeof b.jeton !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.jeton)) return json(req, 400, { error: 'Requête invalide' });
  const db = admin();
  const { data: s } = await db.from('event_signups').select('id, prenom, email, camp, reponse, event_key, lien_envoye_at').eq('jeton', b.jeton).maybeSingle();
  if (!s || s.reponse !== 'oui' || !s.camp) return json(req, 404, { error: 'Salle introuvable.' });
  if (s.lien_envoye_at && Date.now() - new Date(s.lien_envoye_at).getTime() < 10 * 60 * 1000) return json(req, 200, { ok: true, deja: true });
  const { data: ev } = await db.from('events').select('title, starts_at, location').eq('id', s.event_key).maybeSingle();
  if (!ev) return json(req, 404, { error: 'Événement introuvable.' });
  const quand = new Date(ev.starts_at).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });
  const lien = `${SITE}/salle?t=${b.jeton}`;
  try {
    await sendMail({
      from: FROM, to: s.email, subject: `Ta salle de préparation — camp « ${s.camp} »`,
      html: layout({ title: `Bienvenue dans le camp « ${s.camp} », ${s.prenom} !`, body:
        `<p>Tu participes à <strong>${esc(ev.title)}</strong>, le ${esc(quand)} (${esc(ev.location)}). Le tirage au sort t'a placé dans le camp <strong>« ${esc(s.camp)} »</strong>.</p>
         <p>Ton camp dispose d'une salle de préparation privée : proposez et votez vos arguments, anticipez ce que dira l'autre camp, répartissez les prises de parole et discutez entre vous.</p>
         ${button(lien, 'Entrer dans la salle de mon camp')}
         <p style="color:#555;font-size:14px;">Ce lien est personnel : il t'identifie auprès de ton camp. Ne le partage pas, même avec quelqu'un de ton camp — chacun reçoit le sien.</p>` }),
    });
    await db.from('event_signups').update({ lien_envoye_at: new Date().toISOString() }).eq('id', s.id);
  } catch (e) { console.error(e); return json(req, 500, { error: "L'email n'a pas pu être envoyé." }); }
  return json(req, 200, { ok: true });
});

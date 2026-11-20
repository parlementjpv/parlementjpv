import { admin, sendMail, json, FROM, BUREAU_EMAIL, cors, readJson } from '../_shared/lib.ts';
import { quand, lienEvenement, type Ev } from '../_shared/evenement.ts';
import { mailWhatsApp } from '../_shared/whatsapp.ts';

// Appelée par la base (trigger) quand un événement est publié, modifié ou annulé :
// envoie au Parlement le message prêt à poster dans le groupe WhatsApp.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const s = Deno.env.get('BACKUP_SECRET');
  if (!s || req.headers.get('x-sauvegarde') !== s) return json(req, 401, { error: 'Non autorisé' });
  const b = await readJson(req);
  const { data: ev } = await admin().from('events').select('*').eq('id', b?.id).maybeSingle<Ev & { annule_at: string | null }>();
  if (!ev) return json(req, 404, { error: 'Événement introuvable' });
  const action = ev.annule_at ? 'annule' : b.action === 'modifie' ? 'modifie' : 'nouveau';
  const entete = { nouveau: `📢 *Nouvelle séance : ${ev.title}*`, modifie: `✏️ *Séance modifiée : ${ev.title}*`, annule: `❌ *Séance annulée : ${ev.title}*` }[action];
  const lignes = [entete, '', `🗓 ${quand(ev)}`, `📍 ${ev.location}`];
  if (action !== 'annule') {
    if (ev.camps?.length) lignes.push(`⚖️ Camps : ${ev.camps.join(' / ')} (tirés au sort)`);
    if (ev.description) lignes.push('', ev.description.length > 400 ? ev.description.slice(0, 400) + '…' : ev.description);
    lignes.push('', `👉 Dis-nous si tu viens : ${lienEvenement(ev)}`);
  } else lignes.push('', 'Tu n\'as rien à faire, une nouvelle date sera annoncée.');
  const texte = lignes.join('\n');
  const intro = { nouveau: 'Une nouvelle séance vient d\'être publiée sur le site.', modifie: 'Une séance vient d\'être modifiée sur le site.', annule: 'Une séance vient d\'être annulée.' }[action];
  await sendMail({ from: FROM, to: BUREAU_EMAIL, subject: `WhatsApp : ${entete.replace(/[*📢✏️❌]/gu, '').trim()}`, html: mailWhatsApp(intro, texte), text: texte });
  return json(req, 200, { ok: true, action });
});

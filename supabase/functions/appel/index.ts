import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest, journal } from '../_shared/lib.ts';

// Appel d'une séance par le bureau. Au-delà du seuil d'absences non excusées, le compte est exclu
// automatiquement ; à la dernière absence tolérée, un avertissement est envoyé.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req);
  if (!b?.event || !Array.isArray(b.lignes) || b.lignes.length > 500) return json(req, 400, { error: 'Requête invalide' });
  const db = admin();
  const { data: ev } = await db.from('events').select('title, starts_at').eq('id', b.event).maybeSingle();
  if (!ev) return json(req, 404, { error: 'Événement introuvable.' });
  if (new Date(ev.starts_at).getTime() - Date.now() > 6 * 3600 * 1000) return json(req, 400, { error: "L'appel ne peut être fait qu'à partir du jour de la séance." });
  const { data, error } = await db.rpc('enregistrer_appel', { p_event: b.event, p_lignes: b.lignes });
  if (error) { console.error(error); return json(req, 500, { error: "L'appel n'a pas pu être enregistré." }); }
  const quand = new Date(ev.starts_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const notifs = (data?.notifications || []) as { email: string; prenom: string; absences: number; action: string }[];
  for (const n of notifs) {
    try {
      if (n.action === 'exclu') {
        await sendMail({ from: FROM, to: n.email, subject: 'Ton compte Parlement JPV est suspendu',
          html: layout({ title: `${n.prenom}, ton compte est suspendu`, body:
            `<p>Tu étais inscrit à <strong>${esc(ev.title)}</strong> (${esc(quand)}) mais tu n'étais pas présent. C'est ta ${n.absences}<sup>e</sup> absence non excusée : comme le prévoit le règlement de l'instance, ton compte est suspendu au-delà de ${data.seuil} absences.</p>
             <p>Si c'est une erreur ou si tu avais une bonne raison, réponds simplement à cet email : le bureau peut réactiver ton compte.</p>
             <p style="color:#555;font-size:14px;">Le bureau du Parlement JPV</p>` }) });
      } else {
        await sendMail({ from: FROM, to: n.email, subject: 'Absence à la séance — attention',
          html: layout({ title: `${n.prenom}, on ne t'a pas vu`, body:
            `<p>Tu étais inscrit à <strong>${esc(ev.title)}</strong> (${esc(quand)}) mais tu n'étais pas présent. C'est ta ${n.absences}<sup>e</sup> absence non excusée.</p>
             <p><strong>À la prochaine absence non excusée, ton compte sera suspendu automatiquement.</strong> Si tu ne peux pas venir à une séance, change simplement ta réponse en « Je ne viens pas » avant qu'elle commence : ça ne compte pas comme une absence.</p>
             ${button(`${SITE}/compte`, 'Mon espace')}
             <p style="color:#555;font-size:14px;">Le bureau du Parlement JPV</p>` }) });
      }
    } catch (e) { console.error(e); }
  }
  const n = (s: string) => b.lignes.filter((l: any) => l.statut === s).length;
  await journal(me.user.id, 'Séances', `a fait l'appel de « ${ev.title} » : ${n('present')} présents, ${n('absent')} absents, ${n('excuse')} excusés${notifs.some((x) => x.action === 'exclu') ? ` — suspendu${notifs.filter((x) => x.action === 'exclu').length > 1 ? 's' : ''} : ${notifs.filter((x) => x.action === 'exclu').map((x) => x.prenom).join(', ')}` : ''}`);
  return json(req, 200, { ok: true, seuil: data?.seuil, exclus: notifs.filter((n) => n.action === 'exclu').map((n) => n.prenom), avertis: notifs.filter((n) => n.action !== 'exclu').map((n) => n.prenom) });
});

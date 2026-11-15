import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson } from '../_shared/lib.ts';
import { fiche, lienEvenement, type Ev } from '../_shared/evenement.ts';
import { pushUtilisateurs } from '../_shared/push.ts';

// Rappel envoyé la veille de chaque séance à tous les inscrits (« Je viens »), par email + notification.
// Appelée chaque jour par une tâche planifiée (pg_cron) avec l'en-tête secret x-sauvegarde.
// Mode test : { event, seulement: [emails] } envoie le rappel de cette séance aux seules adresses indiquées, sans le marquer comme envoyé.
const jourParis = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const secret = Deno.env.get('BACKUP_SECRET');
  if (!secret || req.headers.get('x-sauvegarde') !== secret) return json(req, 401, { error: 'Non autorisé' });
  const b = (await readJson(req)) || {};
  const seulement: string[] | null = Array.isArray(b.seulement) ? b.seulement.map((x: string) => String(x).toLowerCase()) : null;
  const test = !!(b.event && seulement);
  const db = admin();

  let evs: Ev[] = [];
  if (test) {
    const { data } = await db.from('events').select('*').eq('id', b.event).maybeSingle<Ev>();
    if (data) evs = [data];
  } else {
    const demain = jourParis(new Date(Date.now() + 86400000));
    const { data } = await db.from('events').select('*').is('annule_at', null).is('rappel_veille_at', null)
      .gte('starts_at', new Date().toISOString()).lte('starts_at', new Date(Date.now() + 2 * 86400000).toISOString());
    evs = ((data || []) as Ev[]).filter((e) => jourParis(new Date(e.starts_at)) === demain);
  }

  const bilan: { titre: string; emails: number; push: number }[] = [];
  for (const ev of evs) {
    if (!test) {
      const { data: lock } = await db.from('events').update({ rappel_veille_at: new Date().toISOString() }).eq('id', ev.id).is('rappel_veille_at', null).select('id');
      if (!lock?.length) continue;
    }
    const { data: inscrits } = await db.from('event_signups').select('prenom, email, user_id, camp, jeton').eq('event_key', ev.id).eq('reponse', 'oui');
    const dest = (inscrits || []).filter((s) => !seulement || seulement.includes(s.email.toLowerCase()));
    const heure = new Date(ev.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
    let emails = 0;
    for (const s of dest) {
      try {
        await sendMail({ from: FROM, to: s.email, subject: `C'est demain : ${ev.title}`,
          html: layout({ title: `${s.prenom}, on se voit demain à ${heure}`, body:
            `<p>Petit rappel : tu as confirmé ta présence à cette séance.</p>${fiche(ev, s.camp)}
             ${s.camp && s.jeton ? `<p>Dernière ligne droite pour préparer tes arguments avec ton camp :</p>${button(`${SITE}/salle?t=${s.jeton}`, 'Ouvrir la salle de mon camp')}` : button(lienEvenement(ev), 'Voir la séance')}
             <p style="color:#555;font-size:14px;">Tu ne peux plus venir ? <a href="${lienEvenement(ev)}" style="color:#555;">Change ta réponse en « Je ne viens pas »</a> avant le début : ça ne compte pas comme une absence.</p>` }) });
        emails++;
      } catch (e) { console.error(e); }
    }
    const { envoyes: push } = await pushUtilisateurs(dest.map((s) => s.user_id), { titre: `C'est demain à ${heure}`, texte: `${ev.title} — ${ev.location}`, url: lienEvenement(ev), tag: `seance-${ev.id}` });
    bilan.push({ titre: ev.title, emails, push });
  }
  return json(req, 200, { ok: true, test, seances: bilan });
});

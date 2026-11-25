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
    const { data: args } = await db.from('camp_posts').select('camp, titre, contenu, auteur_nom, retenu').eq('event_key', ev.id).eq('kind', 'argument').order('retenu', { ascending: false }).order('created_at');
    const blocCamp = (camp: string) => {
      const a = (args || []).filter((x) => x.camp === camp).slice(0, 6);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;"><tr><td style="border-left:4px solid #d62839;background:#fdf6f6;border-radius:6px;padding:14px 16px;">
        <strong style="font-size:16px;">Tu es attendu·e dans le camp « ${esc(camp)} »</strong>
        ${a.length ? `<p style="margin:8px 0 6px;font-size:14px;">Les arguments déjà préparés par ton camp :</p><ol style="margin:0;padding-left:20px;font-size:14px;">${a.map((x) => `<li style="margin-bottom:6px;"><strong>${esc(x.titre || x.contenu.slice(0, 80))}</strong>${x.titre ? `<br><span style="color:#4a5370;">${esc(x.contenu.slice(0, 220))}${x.contenu.length > 220 ? '…' : ''}</span>` : ''}${x.retenu ? ' <span style="color:#1d7a46;font-size:12px;">· retenu</span>' : ''}</li>`).join('')}</ol>${(args || []).filter((x) => x.camp === camp).length > 6 ? '<p style="font-size:13px;color:#5d6477;margin:6px 0 0;">… et d\'autres dans la salle du camp.</p>' : ''}`
          : `<p style="margin:8px 0 0;font-size:14px;">Ton camp n'a encore posté aucun argument : c'est le moment d'en proposer un !</p>`}
      </td></tr></table>`;
    };
    const dest = (inscrits || []).filter((s) => !seulement || seulement.includes(s.email.toLowerCase()));
    const heure = new Date(ev.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
    let emails = 0;
    for (const s of dest) {
      try {
        await sendMail({ from: FROM, to: s.email, subject: s.camp ? `C'est demain : ${ev.title} — tu es dans le camp ${s.camp}` : `C'est demain : ${ev.title}`,
          html: layout({ title: `${s.prenom}, on se voit demain à ${heure}`, body:
            `<p>Petit rappel : tu as confirmé ta présence à cette séance.</p>${fiche(ev, s.camp)}${s.camp ? blocCamp(s.camp) : ''}
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

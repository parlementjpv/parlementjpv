import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest, journal } from '../_shared/lib.ts';
import { pushUtilisateurs } from '../_shared/push.ts';
import { quand, type Ev } from '../_shared/evenement.ts';

// Annulation d'un événement : prévient automatiquement tous les inscrits
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req); if (!b?.id) return json(req, 400, { error: 'Requête invalide' });
  const motif = typeof b.motif === 'string' ? b.motif.trim().slice(0, 1000) : '';
  const db = admin();
  const { data: done } = await db.from('events').update({ annule_at: new Date().toISOString(), annule_motif: motif || null }).eq('id', b.id).is('annule_at', null).select('*');
  const ev = done?.[0] as Ev | undefined;
  if (!ev) return json(req, 404, { error: 'Événement introuvable ou déjà annulé.' });
  const { data: inscrits } = await db.from('event_signups').select('prenom, email, user_id').eq('event_key', ev.id).eq('reponse', 'oui');
  let envoyes = 0;
  for (const s of inscrits || []) {
    try {
      await sendMail({
        from: FROM, to: s.email, subject: `Annulé : ${ev.title}`,
        html: layout({ title: `${s.prenom}, la séance est annulée`, body:
          `<p>Nous sommes désolés : <strong>${esc(ev.title)}</strong>, prévu le ${esc(quand(ev))} (${esc(ev.location)}), est <strong style="color:#d62839;">annulé</strong>.</p>
           ${motif ? `<p style="border-left:4px solid #d62839;padding-left:12px;white-space:pre-wrap;">${esc(motif)}</p>` : ''}
           <p>Tu n'as rien à faire. Nous te préviendrons dès qu'une nouvelle séance sera programmée.</p>
           ${button(`${SITE}/evenement`, 'Voir les prochaines séances')}
           <p style="color:#555;font-size:14px;">Le bureau du Parlement JPV</p>` }),
      });
      envoyes++;
    } catch (e) { console.error(e); }
  }
  await pushUtilisateurs((inscrits || []).map((s) => s.user_id), { titre: 'Séance annulée', texte: `${ev.title}, prévu le ${quand(ev)}, est annulé.`, url: `${SITE}/compte`, tag: `seance-${ev.id}` });
  await journal(me.user.id, 'Séances', `a annulé la séance « ${ev.title} »${motif ? ` (motif : ${motif.slice(0, 120)})` : ''} — ${envoyes} inscrit${envoyes > 1 ? 's' : ''} prévenu${envoyes > 1 ? 's' : ''}`);
  return json(req, 200, { ok: true, envoyes });
});

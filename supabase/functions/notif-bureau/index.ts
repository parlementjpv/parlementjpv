import { admin, json, cors, readJson, userFromRequest, journal, SITE } from '../_shared/lib.ts';
import { pushUtilisateurs } from '../_shared/push.ts';

// Notification envoyée par le bureau à un groupe de membres (téléphones où les notifications sont activées)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req);
  const titre = String(b?.titre || '').trim().slice(0, 80), texte = String(b?.texte || '').trim().slice(0, 300);
  if (!titre || !texte || !['tous', 'bureau', 'seance'].includes(b?.cible)) return json(req, 400, { error: 'Titre, message et destinataires obligatoires.' });
  const db = admin();
  let ids: string[] = [], libelle = '', url = `${SITE}/compte`;
  if (b.cible === 'tous') {
    const { data } = await db.from('profiles').select('id').eq('banni', false); ids = (data || []).map((x) => x.id); libelle = 'Tous les membres';
  } else if (b.cible === 'bureau') {
    const { data } = await db.from('profiles').select('id').eq('banni', false).in('role', ['bureau', 'admin']); ids = (data || []).map((x) => x.id); libelle = 'Le bureau';
  } else {
    const { data: ev } = await db.from('events').select('id, title').eq('id', b.event).maybeSingle();
    if (!ev) return json(req, 404, { error: 'Séance introuvable.' });
    const { data } = await db.from('event_signups').select('user_id').eq('event_key', ev.id).eq('reponse', 'oui').not('user_id', 'is', null);
    ids = (data || []).map((x) => x.user_id); libelle = `Inscrits à « ${ev.title} »`; url = `${SITE}/evenement?e=${ev.id}`;
  }
  const { data: joignables } = ids.length ? await db.from('push_abonnements').select('user_id').in('user_id', ids) : { data: [] };
  const personnes = new Set((joignables || []).map((x) => x.user_id)).size;
  const { envoyes } = await pushUtilisateurs(ids, { titre, texte, url });
  const nom = `${me.profile?.prenom || ''} ${me.profile?.nom || ''}`.trim();
  await db.from('notifs_bureau').insert({ auteur: me.user.id, auteur_nom: nom, titre, texte, cible: libelle, personnes, appareils: envoyes });
  await journal(me.user.id, 'Communication', `a envoyé la notification « ${titre} » (${libelle}) : ${personnes} membre${personnes > 1 ? 's' : ''} joint${personnes > 1 ? 's' : ''}`);
  return json(req, 200, { ok: true, personnes, appareils: envoyes, cibles: ids.length });
});

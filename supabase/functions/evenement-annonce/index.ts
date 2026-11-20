import { admin, sendMail, json, esc, layout, button, FROM, cors, readJson, userFromRequest, journal } from '../_shared/lib.ts';
const SUPA = Deno.env.get('SUPABASE_URL')!;
import { pushUtilisateurs } from '../_shared/push.ts';
import { fiche, lienEvenement, type Ev } from '../_shared/evenement.ts';

// Annonce d'une nouvelle séance à tous les membres de l'instance (une seule fois par événement)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req); if (!b?.id) return json(req, 400, { error: 'Requête invalide' });
  const db = admin();
  const { data: ev } = await db.from('events').select('*').eq('id', b.id).eq('published', true).is('annule_at', null).maybeSingle<Ev & { annonce_at: string | null }>();
  if (!ev) return json(req, 404, { error: 'Événement introuvable.' });
  if (ev.annonce_at) return json(req, 200, { ok: true, deja: true, envoyes: 0 });
  if (new Date(ev.starts_at).getTime() < Date.now()) return json(req, 400, { error: 'Événement déjà passé.' });
  // Verrou : on marque l'annonce avant d'envoyer pour éviter tout double envoi
  const { data: lock } = await db.from('events').update({ annonce_at: new Date().toISOString() }).eq('id', ev.id).is('annonce_at', null).select('id');
  if (!lock?.length) return json(req, 200, { ok: true, deja: true, envoyes: 0 });

  const [{ data: membres }, { data: bannis }] = await Promise.all([
    db.from('adhesions').select('prenom, email, user_id, desabo_token').eq('annonces', true),
    db.from('profiles').select('id').eq('banni', true),
  ]);
  const exclus = new Set((bannis || []).map((p) => p.id));
  const vus = new Set<string>();
  const dest = (membres || []).filter((m) => !(m.user_id && exclus.has(m.user_id)) && !vus.has(m.email.toLowerCase()) && vus.add(m.email.toLowerCase()));
  let envoyes = 0; const echecs: string[] = [];
  for (const m of dest) {
    try {
      await sendMail({
        from: FROM, to: m.email, subject: `Nouvelle séance : ${ev.title}`,
        html: layout({ title: `${m.prenom}, une nouvelle séance est programmée`, body:
          `<p>Le bureau vient de publier une nouvelle séance du Parlement JPV.</p>${fiche(ev)}
           <p>Dis-nous si tu viens : ça prend dix secondes${ev.camps?.length ? ', et ton camp sera tiré au sort' : ''}.</p>
           ${button(lienEvenement(ev), 'Je réponds')}
           <p style="color:#555;font-size:13px;">Tu reçois cet email parce que tu es membre du Parlement JPV.</p>`,
          unsubscribeUrl: `${SUPA}/functions/v1/annonces-stop?t=${m.desabo_token}`, unsubscribeLabel: 'Me désabonner des annonces' }),
        headers: { 'List-Unsubscribe': `<${SUPA}/functions/v1/annonces-stop?t=${m.desabo_token}>` },
      });
      envoyes++;
    } catch (e) { console.error(e); echecs.push(m.email); }
  }
  await pushUtilisateurs(dest.map((m) => m.user_id), { titre: 'Nouvelle séance', texte: `${ev.title} — ${new Date(ev.starts_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}. Dis-nous si tu viens !`, url: lienEvenement(ev), tag: `seance-${ev.id}` });
  await journal(me.user.id, 'Séances', `a annoncé la séance « ${ev.title} » à ${envoyes} membre${envoyes > 1 ? 's' : ''}`);
  return json(req, 200, { ok: true, envoyes, echecs: echecs.length });
});

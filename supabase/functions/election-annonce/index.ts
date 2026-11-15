import { pushUtilisateurs } from '../_shared/push.ts';
import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, userFromRequest, journal } from '../_shared/lib.ts';

// Prévient par email chaque membre pouvant voter qu'un vote est ouvert (une seule fois par élection).
// Mode test (en-tête secret de sauvegarde) : { id, seulement: [emails] } limite l'envoi à ces adresses.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const secret = Deno.env.get('BACKUP_SECRET');
  const service = !!secret && req.headers.get('x-sauvegarde') === secret;
  const me = service ? null : await userFromRequest(req);
  if (!service && !me) return json(req, 401, { error: 'Ta session a expiré : recharge la page puis réessaie.' });
  if (!service && !['bureau', 'admin'].includes(me!.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const b = await readJson(req); if (!b?.id) return json(req, 400, { error: 'Requête invalide' });
  const seulement: string[] | null = service && Array.isArray(b.seulement) ? b.seulement.map((x: string) => String(x).toLowerCase()) : null;
  const db = admin();

  const { data: lock } = await db.from('elections').update({ annonce_envoyee_at: new Date().toISOString() })
    .eq('id', b.id).eq('statut', 'ouverte').is('annonce_envoyee_at', null).select('id, titre, poste, description, ouverture, fermeture');
  const e = lock?.[0];
  if (!e) return json(req, 200, { ok: true, deja: true, envoyes: 0 });

  // Électeurs : comptes créés avant l'ouverture, non bannis
  const ouv = e.ouverture || new Date().toISOString();
  const { data: profs } = await db.from('profiles').select('id, prenom').eq('banni', false).lt('created_at', ouv);
  const ids = (profs || []).map((p) => p.id);
  const { data: adh } = ids.length ? await db.from('adhesions').select('user_id, email').in('user_id', ids) : { data: [] as { user_id: string; email: string }[] };
  const mail = new Map((adh || []).map((a) => [a.user_id, a.email]));
  const vus = new Set<string>(); const dest: { email: string; prenom: string; id: string }[] = [];
  for (const p of profs || []) {
    let email = mail.get(p.id);
    if (!email) { const { data } = await db.auth.admin.getUserById(p.id); email = data?.user?.email || undefined; }
    if (!email) continue;
    const k = email.toLowerCase();
    if (vus.has(k) || (seulement && !seulement.includes(k))) continue;
    vus.add(k); dest.push({ email, prenom: p.prenom || '', id: p.id });
  }

  const fmt = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const programme = e.ouverture && new Date(e.ouverture).getTime() > Date.now();
  const quand = programme
    ? `Le vote ouvre le <strong>${fmt(e.ouverture)}</strong>${e.fermeture ? ` et ferme le <strong>${fmt(e.fermeture)}</strong>` : ''}.`
    : e.fermeture ? `Tu peux voter jusqu'au <strong>${fmt(e.fermeture)}</strong>.` : 'Le vote est ouvert dès maintenant.';
  let envoyes = 0; const echecs: string[] = [];
  for (const d of dest) {
    try {
      await sendMail({
        from: FROM, to: d.email, subject: `Vote ${programme ? 'programmé' : 'ouvert'} : ${e.titre}`,
        html: layout({ title: `${d.prenom ? d.prenom + ', à' : 'À'} toi de voter`, body:
          `<p>Le bureau du Parlement JPV a ouvert une élection : <strong>${esc(e.titre)}</strong>${e.poste ? ` (poste : ${esc(e.poste)})` : ''}.</p>
           ${e.description ? `<p>${esc(e.description)}</p>` : ''}
           <p>${quand}</p>
           <p>Le vote est à bulletin secret : le site enregistre seulement que tu as voté, jamais pour qui. Tu ne peux voter qu'une fois.</p>
           ${button(`${SITE}/elections`, 'Je vote')}` }),
      });
      envoyes++;
    } catch (err) { console.error(err); echecs.push(d.email); }
  }
  await pushUtilisateurs(dest.map((d) => d.id), { titre: programme ? 'Vote programmé' : 'Vote ouvert', texte: `${e.titre} — ${programme ? `ouverture le ${fmt(e.ouverture)}` : 'à toi de voter !'}`, url: `${SITE}/elections`, tag: `election-${e.id}` });
  if (me) await journal(me.user.id, 'Élections', `a annoncé le vote « ${e.titre} » à ${envoyes} membre${envoyes > 1 ? 's' : ''}`);
  return json(req, 200, { ok: true, envoyes, echecs: echecs.length });
});

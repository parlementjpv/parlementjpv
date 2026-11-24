import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter, configure } from 'npm:@zip.js/zip.js@2.7.52';

// Pas de Web Workers sur le serveur ; les PDF sont déjà compressés : on chiffre sans recompresser (moins de calcul)
configure({ useWebWorkers: false, useCompressionStream: false });
import { admin, json, cors, readJson, sendMail, layout, FROM, userFromRequest, journal, esc } from '../_shared/lib.ts';

// Envoi des documents PDF du bureau par email, dans un ZIP chiffré AES-256, à l'adresse du Parlement :
//  - archive automatique toutes les deux semaines (pg_cron, clé serveur) : tous les documents ;
//  - « Envoyer par email » depuis l'espace bureau (utilisateur du bureau) : le ou les documents demandés.
// Archive automatique (toutes les deux semaines) : tous les documents PDF du bureau,
// réunis dans un ZIP chiffré AES-256, envoyés à l'adresse du Parlement.
// Le mot de passe, différent à chaque archive, n'est jamais envoyé : il est enregistré dans la base
// (table archives_pdf), consultable par les seuls administrateurs sur le site, et effacé au bout d'un an.
// Déclenchée par la base (pg_cron, chaque lundi) avec l'en-tête secret x-sauvegarde ; n'envoie qu'une semaine sur deux.

/** Mot de passe aléatoire, différent pour chaque archive (24 caractères, sans caractères ambigus). */
function motDePasse() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(24));
  return Array.from(r, (x) => abc[x % abc.length]).join('').replace(/(.{6})(?=.)/g, '$1-');
}

/** Fabrique les PDF demandés (un appel séparé par document), les chiffre dans un ZIP, l'envoie et enregistre le mot de passe. */
async function envoyer(db: ReturnType<typeof admin>, demandes: [string, any][], o: { libelle: string; demandePar: string; test: boolean; auto: boolean }) {
  const secret = Deno.env.get('BACKUP_SECRET')!;
  const mdp = motDePasse();
  const zip = new ZipWriter(new Uint8ArrayWriter(), { password: mdp, encryptionStrength: 3, zipCrypto: false, level: 0 });
  const liste: string[] = []; let echecs = 0;
  // Fabrication en parallèle (4 à la fois), chaque PDF dans son propre appel ; ajout au ZIP dans l'ordre
  const fab = async ([dossier, d]: [string, any]) => {
    try {
      const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/telecharger`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sauvegarde': secret, 'x-demandeur': encodeURIComponent(o.demandePar) }, body: JSON.stringify(d) });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('application/pdf')) { console.error('pdf', d, r.status); return null; }
      return { nom: decodeURIComponent(r.headers.get('x-fichier') || `${d.type}.pdf`), dossier, octets: new Uint8Array(await r.arrayBuffer()) };
    } catch (e) { console.error(e); return null; }
  };
  const fab2 = async (x: [string, any]) => (await fab(x)) || (await new Promise((r) => setTimeout(r, 1500)), await fab(x));
  for (let i = 0; i < demandes.length; i += 3) {
    for (const f of await Promise.all(demandes.slice(i, i + 3).map(fab2))) {
      if (!f) { echecs++; continue; }
      await zip.add(f.dossier ? `${f.dossier}/${f.nom}` : f.nom, new Uint8ArrayReader(f.octets));
      liste.push(f.dossier ? `${f.dossier} · ${f.nom}` : f.nom);
    }
  }
  if (!liste.length) return { ok: false as const, error: "Aucun document n'a pu être généré." };
  const contenu: Uint8Array = await zip.close();
  const maintenant = new Date();
  const jour = maintenant.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });
  const heure = maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
  const nomZip = o.auto ? `archive-parlement-jpv-${maintenant.toISOString().slice(0, 10)}.zip` : `documents-parlement-jpv-${maintenant.toISOString().slice(0, 16).replace(/[T:]/g, '-')}.zip`;
  const dest = o.test ? 'gustave.jeannin14@gmail.com' : (Deno.env.get('BACKUP_EMAIL') || Deno.env.get('SMTP_USER')!);
  const { data: rang, error: errMdp } = await db.from('archives_pdf').insert({ fichier: nomZip, documents: liste.length, destinataire: dest, test: o.test, mot_de_passe: mdp, libelle: o.libelle, demande_par: o.demandePar }).select('id').single();
  if (errMdp) { console.error(errMdp); return { ok: false as const, error: 'Mot de passe non enregistré : rien n\'a été envoyé.' }; }
  try {
    await sendMail({ from: FROM, to: dest, subject: `${o.test ? '[TEST] ' : ''}${o.auto ? 'Archive des documents du Parlement' : `Documents du Parlement : ${o.libelle}`} — ${jour}`, attachments: [{ filename: nomZip, content: contenu, contentType: 'application/zip' }],
      html: layout({ title: o.auto ? `Archive des documents du ${jour}` : esc(o.libelle), body:
        `<p>${o.auto ? "Voici l'archive automatique des documents du bureau (envoyée toutes les deux semaines)." : `Document${liste.length > 1 ? 's' : ''} demandé${liste.length > 1 ? 's' : ''} par <strong>${esc(o.demandePar)}</strong> depuis l'espace bureau, le ${jour} à ${heure}.`}</p>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;"><tr><td style="border-left:4px solid #d62839;background:#fdecee;border-radius:6px;padding:14px 16px;font-size:14.5px;line-height:1.55;">
           <strong>Fichier chiffré.</strong> La pièce jointe est un ZIP protégé par mot de passe (chiffrement AES-256). Le mot de passe, différent pour chaque envoi, n'est volontairement <strong>pas</strong> dans cet email. Un administrateur le trouve sur le site : <strong>parlementjpv.fr → Espace bureau → Téléchargements → Archives</strong>, à la ligne du ${jour} à ${heure}. Il est effacé automatiquement au bout d'un an : le fichier devient alors illisible.</td></tr></table>
         <p style="margin:0 0 6px;"><strong>${liste.length} document${liste.length > 1 ? 's' : ''}</strong>${echecs ? ` (${echecs} n'ont pas pu être générés)` : ''} :</p>
         <ul style="margin:0 0 14px;padding-left:20px;font-size:13.5px;color:#4a5370;">${liste.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
         <p style="font-size:13px;color:#5d6477;">Pour l'ouvrir : sur ordinateur, double-clic puis saisie du mot de passe (sur Windows, 7-Zip ; sur Mac, Keka ou The Unarchiver) ; sur iPhone, l'app Fichiers ne gère pas ce chiffrement : utiliser par exemple l'app gratuite « iZip ». Documents confidentiels : ne pas transférer ; supprimer les anciennes archives.</p>` }) });
  } catch (e) { console.error(e); await db.from('archives_pdf').delete().eq('id', rang.id); return { ok: false as const, error: "L'email n'a pas pu partir." }; }
  return { ok: true as const, documents: liste.length, echecs, taille: contenu.length, a: dest, heure: `${jour} à ${heure}` };
}

/** Tous les documents du bureau, rangés par dossier. */
async function listeComplete(db: ReturnType<typeof admin>): Promise<[string, any][]> {
  const il_y_a = new Date(Date.now() - 60 * 86400000).toISOString();
  const [{ data: el }, { data: sd }, { data: so }, { data: ev }] = await Promise.all([
    db.from('elections').select('id').eq('publiee', true),
    db.from('sondages').select('id'),
    db.from('sorties').select('id').gte('quand', il_y_a),
    db.from('events').select('id, starts_at').gte('starts_at', il_y_a),
  ]);
  const passees = (ev || []).filter((e) => e.starts_at <= new Date().toISOString());
  return [
    ['01-Bilan', { type: 'rapport-annuel' }], ['01-Bilan', { type: 'registre' }], ['01-Bilan', { type: 'assiduite' }], ['01-Bilan', { type: 'recueil' }],
    ['02-Membres', { type: 'membres' }], ['03-Candidatures', { type: 'candidatures' }], ['04-Certificats', { type: 'certificats' }],
    ...(el || []).flatMap((e) => [['05-Elections', { type: 'election', id: e.id }], ['05-Elections', { type: 'pv-election', id: e.id }]] as [string, any][]),
    ...(ev || []).map((e) => ['06-Seances', { type: 'seance', id: e.id }] as [string, any]),
    ...passees.map((e) => ['07-Comptes-rendus', { type: 'compte-rendu', id: e.id }] as [string, any]),
    ...(sd || []).map((s) => ['08-Sondages', { type: 'sondage', id: s.id }] as [string, any]),
    ...(so || []).map((s) => ['09-Sorties', { type: 'sortie', id: s.id }] as [string, any]),
  ];
}

Deno.serve(async (req) => { try { return await traiter(req); } catch (e) { console.error(e); return json(req, 500, { error: 'Erreur serveur : ' + String((e as Error)?.message || e).slice(0, 200) }); } });

async function traiter(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const secret = Deno.env.get('BACKUP_SECRET');
  const b = (await readJson(req)) || {};
  const db = admin();

  // 1) Archive automatique (pg_cron, clé serveur)
  if (secret && req.headers.get('x-sauvegarde') === secret) {
    const semaine = Math.floor(Date.now() / (7 * 86400000));
    if (!b.forcer && semaine % 2 !== 0) return json(req, 200, { ok: true, saute: 'semaine impaire' });
    const r = await envoyer(db, await listeComplete(db), { libelle: 'Archive automatique (tous les documents)', demandePar: "l'archive automatique", test: !!b.test, auto: true });
    return json(req, r.ok ? 200 : 500, r);
  }

  // 2) « Envoyer par email » depuis l'espace bureau
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  const role = me.profile?.role;
  if (!['bureau', 'admin'].includes(role)) return json(req, 403, { error: 'Réservé au bureau.' });
  if (b.complet || b.complete) {
    if (role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
    const demandePar = [me.profile?.prenom, me.profile?.nom].filter(Boolean).join(' ') || 'un administrateur';
    // Long : préparé en arrière-plan, réponse immédiate
    const tache = (async () => {
      const r = await envoyer(db, await listeComplete(db), { libelle: 'Archive complète (tous les documents)', demandePar, test: false, auto: false });
      await journal(me.user.id, 'Téléchargements', r.ok ? `a envoyé par email l'archive complète (ZIP chiffré, ${r.documents} documents)` : `archive complète en échec : ${r.error}`);
    })();
    // @ts-ignore EdgeRuntime est fourni par Supabase
    EdgeRuntime.waitUntil(tache);
    return json(req, 200, { ok: true, enCours: true, a: Deno.env.get('BACKUP_EMAIL') || Deno.env.get('SMTP_USER') });
  }
  const TYPES = role === 'admin' ? ['certificats', 'certificat', 'candidatures', 'candidature', 'election', 'pv-election', 'seance', 'compte-rendu', 'membres', 'sondage', 'sortie', 'rapport-annuel', 'registre', 'assiduite', 'recueil'] : ['candidature'];
  const docs = (Array.isArray(b.docs) ? b.docs : []).slice(0, 10).filter((d: any) => d && TYPES.includes(d.type));
  if (!docs.length) return json(req, 403, { error: 'Document non autorisé.' });
  const libelle = String(b.libelle || 'Document du bureau').slice(0, 140);
  const demandePar = [me.profile?.prenom, me.profile?.nom].filter(Boolean).join(' ') || 'un membre du bureau';
  const r = await envoyer(db, docs.map((d: any) => ['', d] as [string, any]), { libelle, demandePar, test: false, auto: false });
  if (!r.ok) return json(req, 500, { error: r.error });
  await journal(me.user.id, 'Téléchargements', `a envoyé par email (ZIP chiffré) : ${libelle}`);
  return json(req, 200, r);
}

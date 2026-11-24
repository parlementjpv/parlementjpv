import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from 'npm:@zip.js/zip.js@2.7.52';
import { admin, json, cors, readJson, sendMail, layout, FROM } from '../_shared/lib.ts';
import { genererDocument } from '../_shared/documents.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const secret = Deno.env.get('BACKUP_SECRET');
  if (!secret || req.headers.get('x-sauvegarde') !== secret) return json(req, 401, { error: 'Non autorisé' });
  const b = (await readJson(req)) || {};
  // Une semaine sur deux (semaines paires depuis l'époque Unix), sauf envoi forcé
  const semaine = Math.floor(Date.now() / (7 * 86400000));
  if (!b.forcer && semaine % 2 !== 0) return json(req, 200, { ok: true, saute: 'semaine impaire' });

  const db = admin();
  const [{ data: el }, { data: sd }, { data: so }, { data: ev }] = await Promise.all([
    db.from('elections').select('id, titre').eq('publiee', true),
    db.from('sondages').select('id, question'),
    db.from('sorties').select('id, titre').gte('quand', new Date(Date.now() - 60 * 86400000).toISOString()),
    db.from('events').select('id, title').gte('starts_at', new Date(Date.now() - 60 * 86400000).toISOString()),
  ]);
  const demandes: [string, any][] = [
    ['01-Membres', { type: 'membres' }],
    ['02-Candidatures', { type: 'candidatures' }],
    ['03-Certificats', { type: 'certificats' }],
    ...(el || []).map((e) => ['04-Elections', { type: 'election', id: e.id }] as [string, any]),
    ...(ev || []).map((e) => ['05-Seances', { type: 'seance', id: e.id }] as [string, any]),
    ...(sd || []).map((s) => ['06-Sondages', { type: 'sondage', id: s.id }] as [string, any]),
    ...(so || []).map((s) => ['07-Sorties', { type: 'sortie', id: s.id }] as [string, any]),
  ];
  const mdp = motDePasse();
  const zip = new ZipWriter(new Uint8ArrayWriter(), { password: mdp, encryptionStrength: 3, zipCrypto: false });
  const liste: string[] = []; let echecs = 0;
  for (const [dossier, d] of demandes) {
    const r = await genererDocument(db, d, 'l\'archive automatique');
    if ('error' in r) { echecs++; continue; }
    await zip.add(`${dossier}/${r.fichier}`, new Uint8ArrayReader(r.pdf));
    liste.push(`${dossier} · ${r.fichier}`);
  }
  const contenu: Uint8Array = await zip.close();
  const jour = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });
  const nomZip = `archive-parlement-jpv-${new Date().toISOString().slice(0, 10)}.zip`;
  const dest = b.test ? 'gustave.jeannin14@gmail.com' : (Deno.env.get('BACKUP_EMAIL') || Deno.env.get('SMTP_USER')!);
  const { error: errMdp } = await db.from('archives_pdf').insert({ fichier: nomZip, documents: liste.length, destinataire: dest, test: !!b.test, mot_de_passe: mdp });
  if (errMdp) { console.error(errMdp); return json(req, 500, { error: 'Mot de passe non enregistré : archive non envoyée.' }); }
  await sendMail({ from: FROM, to: dest, subject: `${b.test ? '[TEST] ' : ''}Archive des documents du Parlement — ${jour}`, attachments: [{ filename: nomZip, content: contenu, contentType: 'application/zip' }],
    html: layout({ title: `Archive des documents du ${jour}`, body:
      `<p>Voici l'archive automatique des documents du bureau (envoyée toutes les deux semaines).</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;"><tr><td style="border-left:4px solid #d62839;background:#fdecee;border-radius:6px;padding:14px 16px;font-size:14.5px;line-height:1.55;">
         <strong>Archive chiffrée.</strong> Le fichier joint est un ZIP protégé par mot de passe (chiffrement AES-256). Le mot de passe, différent pour chaque archive, n'est volontairement <strong>pas</strong> dans cet email. Un administrateur le trouve sur le site : <strong>parlementjpv.fr → Espace bureau → Téléchargements → Archives</strong>. Il est effacé automatiquement au bout d'un an : l'archive devient alors illisible.</td></tr></table>
       <p style="margin:0 0 6px;"><strong>${liste.length} document${liste.length > 1 ? 's' : ''}</strong>${echecs ? ` (${echecs} n'ont pas pu être générés)` : ''} :</p>
       <ul style="margin:0 0 14px;padding-left:20px;font-size:13.5px;color:#4a5370;">${liste.map((l) => `<li>${l}</li>`).join('')}</ul>
       <p style="font-size:13px;color:#5d6477;">Pour l'ouvrir : sur ordinateur, double-clic puis saisie du mot de passe (sur Windows, 7-Zip ; sur Mac, The Unarchiver ou Keka) ; sur iPhone, l'app Fichiers ne gère pas ce chiffrement : utiliser par exemple l'app gratuite « iZip ». Documents confidentiels : ne pas transférer ; supprimer les anciennes archives.</p>` }) });
  return json(req, 200, { ok: true, documents: liste.length, echecs, taille: contenu.length, a: dest });
});

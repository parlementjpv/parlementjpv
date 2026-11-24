import type { admin } from './lib.ts';
import { DocPdf, C, date, initiale, slug } from './pdf.ts';
import { certificatPdf } from './certificat.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

// Génération des documents PDF du bureau (rubrique Téléchargements et archive automatique).
// Types : certificats, certificat, candidatures, candidature, election, pv-election, seance, compte-rendu, membres, sondage, sortie,
// rapport-annuel, registre, assiduite, recueil.
const STATC: Record<string, string> = { nouvelle: 'Nouvelle', en_cours: 'En cours', acceptee: 'Acceptée', refusee: 'Refusée' };
const ELEVES = ['Seconde', 'Première', 'Terminale'];
const classeDe = (p: any) => p?.niveau ? (ELEVES.includes(p.niveau) ? `${p.niveau}${p.classe_num ? ' ' + p.classe_num : ''}` : p.niveau === 'Personnel' ? 'Personnel du lycée' : p.niveau) : (p?.classe || '—');
const pc = (n: number, t: number) => t ? `${Math.round((n / t) * 100)} %` : '0 %';

export type Resultat = { pdf: Uint8Array; fichier: string; quoi: string } | { status: number; error: string };
const err = (status: number, error: string): Resultat => ({ status, error });

export async function genererDocument(db: ReturnType<typeof admin>, b: any, auteur: string): Promise<Resultat> {
  let d: DocPdf, fichier = '', quoi = '';

  try {
    if (b.type === 'certificats') {
      // Tous les certificats de membre (un par page, paysage), réunis dans un seul PDF
      const [{ data: adh }, { data: profs }] = await Promise.all([
        db.from('adhesions').select('user_id').not('user_id', 'is', null),
        db.from('profiles').select('id, nom, prenom, banni'),
      ]);
      const pm = new Map((profs || []).map((p) => [p.id, p]));
      const ids = [...new Set((adh || []).map((a) => a.user_id))].filter((id) => pm.has(id) && !pm.get(id)!.banni)
        .sort((x, y) => `${pm.get(x)!.nom} ${pm.get(x)!.prenom}`.localeCompare(`${pm.get(y)!.nom} ${pm.get(y)!.prenom}`, 'fr'));
      const recueil = await PDFDocument.create();
      recueil.setTitle(`Certificats de membre — Parlement JPV (${ids.length})`); recueil.setAuthor('Parlement JPV'); recueil.setCreator('parlementjpv.fr');
      // Un certificat à la fois : chaque PDF est ajouté au recueil puis libéré (mémoire limitée du serveur)
      let n = 0;
      for (const id of ids) {
        try {
          const c = await certificatPdf(id); if (!c) continue;
          const src = await PDFDocument.load(c.pdf);
          for (const pg of await recueil.copyPages(src, src.getPageIndices())) recueil.addPage(pg);
          n++;
        } catch (e) { console.error('certificat', id, e); }
      }
      if (!n) return err(404, 'Aucun certificat à générer.');
      return { pdf: await recueil.save(), fichier: `certificats-membres-parlement-jpv-${new Date().toISOString().slice(0, 10)}.pdf`, quoi: `l'intégralité des certificats de membre (${n})` };
    }

    if (b.type === 'certificat') {
      const c = await certificatPdf(b.id);
      if (!c) return err(404, 'Certificat indisponible.');
      return { pdf: c.pdf, fichier: c.nomFichier, quoi: `le certificat de ${c.prenom}` };
    }

    if (b.type === 'candidatures' || b.type === 'candidature') {
      let q = db.from('candidatures').select('*').order('created_at', { ascending: false });
      if (b.filtre === 'ouvertes') q = q.in('statut', ['nouvelle', 'en_cours']);
      if (b.type === 'candidature') q = q.eq('id', b.id);
      const { data: cs } = await q;
      const liste = cs || [];
      d = await DocPdf.creer('Candidatures au bureau', `${b.filtre === 'ouvertes' ? 'Candidatures à traiter' : 'Toutes les candidatures'} — ${liste.length} dossier${liste.length > 1 ? 's' : ''}`, true, auteur);
      const parStatut = (s: string) => liste.filter((c) => c.statut === s).length;
      d.fiche([['Total', String(liste.length)], ['Nouvelles', String(parStatut('nouvelle'))], ['En cours', String(parStatut('en_cours'))], ['Acceptées / refusées', `${parStatut('acceptee')} / ${parStatut('refusee')}`]]);
      d.titreSection('Récapitulatif');
      d.tableau(['Candidat·e', 'Classe', 'Poste visé', 'Déposée le', 'Statut'], [0.26, 0.14, 0.26, 0.18, 0.16],
        liste.map((c) => [{ t: `${c.prenom} ${c.nom}`, gras: true }, c.classe || '—', c.type === 'bureau' ? (c.poste || 'Tout poste') : 'Membre', date(c.created_at), { t: STATC[c.statut] || c.statut, couleur: c.statut === 'acceptee' ? C.vert : c.statut === 'refusee' ? C.rouge : C.texte }]), 'Aucune candidature.');
      for (const c of liste) {
        d.page();
        d.titreSection(`${c.prenom} ${c.nom} — ${c.type === 'bureau' ? (c.poste || 'Tout poste') : 'Membre'}`, C.nuit);
        d.fiche([['Classe', c.classe || '—'], ['Statut', STATC[c.statut] || c.statut], ['Déposée le', date(c.created_at, true)], ['Décision le', c.decided_at ? date(c.decided_at, true) : '—'], ['Email', c.email || '—'], ['Poste', c.type === 'bureau' ? (c.poste || 'Tout poste') : 'Membre']]);
        d.titreSection('Motivation'); d.texte(c.motivation); d.espace();
        d.titreSection('Expérience'); d.texte(c.experience); d.espace();
        d.titreSection('Disponibilités'); d.texte(c.disponibilites); d.espace();
        d.titreSection('Message du bureau'); d.texte(c.note_bureau, 'Aucun message.');
      }
      if (b.type === 'candidature') { if (!liste.length) return err(404, 'Candidature introuvable.'); fichier = `candidature-${slug(liste[0].prenom + ' ' + liste[0].nom)}${liste[0].poste ? '-' + slug(liste[0].poste) : ''}.pdf`; quoi = `la candidature de ${liste[0].prenom} ${liste[0].nom}`; }
      else { fichier = `candidatures-parlement-jpv-${new Date().toISOString().slice(0, 10)}.pdf`; quoi = `les candidatures (${liste.length})`; }
    }

    else if (b.type === 'election') {
      const { data: e } = await db.from('elections').select('*').eq('id', b.id).maybeSingle();
      if (!e) return err(404, 'Élection introuvable.');
      if (!e.publiee) return err(400, 'Les résultats de cette élection ne sont pas encore publiés.');
      const [{ data: cands }, { data: vot }] = await Promise.all([
        db.from('election_candidats').select('nom, voix, ordre').eq('election_id', e.id).order('voix', { ascending: false }),
        db.from('election_votants').select('user_id').eq('election_id', e.id),
      ]);
      const ids = (vot || []).map((v) => v.user_id);
      const { data: profs } = ids.length ? await db.from('profiles').select('id, prenom, nom, niveau, classe_num, classe').in('id', ids) : { data: [] as any[] };
      const exprimes = (cands || []).reduce((a, c) => a + c.voix, 0), total = exprimes + (e.blancs || 0);
      const { count: nbMembres } = await db.from('adhesions').select('*', { count: 'exact', head: true }).not('user_id', 'is', null);
      const max = Math.max(0, ...(cands || []).map((c) => c.voix));
      d = await DocPdf.creer(`Résultats — ${e.titre}`, `Élection${e.poste ? ` au poste de ${e.poste}` : ''} · scrutin clos le ${date(e.fermeture, true)}`, true, auteur);
      d.fiche([['Votants', String(ids.length)], ['Suffrages exprimés', String(exprimes)], ['Votes blancs', String(e.blancs || 0)], ['Participation', nbMembres ? `${Math.round((ids.length / nbMembres) * 100)} % des ${nbMembres} membres` : '—'], ['Ouverture', date(e.ouverture, true)], ['Clôture', date(e.fermeture, true)]]);
      d.titreSection('Résultats');
      for (const c of cands || []) d.barre(c.nom, c.voix, total, `${c.voix} voix · ${pc(c.voix, total)}`, c.voix === max && max > 0);
      d.barre('Votes blancs', e.blancs || 0, total, `${e.blancs || 0} · ${pc(e.blancs || 0, total)}`);
      const gagnants = (cands || []).filter((c) => c.voix === max && max > 0);
      if (gagnants.length === 1) { d.espace(4); d.texte(`${gagnants[0].nom} est élu·e${e.poste ? ` ${e.poste}` : ''}.`, '', 11); }
      else if (gagnants.length > 1) { d.espace(4); d.texte(`Égalité entre ${gagnants.map((g) => g.nom).join(' et ')}.`, '', 11); }
      d.espace(10);
      d.titreSection(`Liste d'émargement — ${ids.length} votant${ids.length > 1 ? 's' : ''}`);
      d.texte("Le vote est secret : cette liste indique uniquement qui a voté, jamais pour qui.", '', 9);
      d.espace(6);
      const votants = (profs || []).map((p) => ({ n: initiale(p.prenom, p.nom), c: classeDe(p) })).sort((a, b) => a.n.localeCompare(b.n, 'fr'));
      d.tableau(['N°', 'Votant·e', 'Classe'], [0.1, 0.55, 0.35], votants.map((v, i) => [String(i + 1), { t: v.n, gras: true }, v.c]), 'Aucun votant.');
      fichier = `resultats-${slug(e.titre)}.pdf`; quoi = `les résultats de l'élection « ${e.titre} »`;
    }

    else if (b.type === 'seance') {
      const { data: ev } = await db.from('events').select('*').eq('id', b.id).maybeSingle();
      if (!ev) return err(404, 'Séance introuvable.');
      const k = String(ev.id);
      const [{ data: ins }, { data: pres }, { data: roles }, { data: posts }, { data: votes }] = await Promise.all([
        db.from('event_signups').select('id, prenom, nom, classe, camp, reponse').eq('event_key', k),
        db.from('presences').select('prenom, nom, classe, statut, camp, roles, arguments_retenus, email').eq('event_key', k),
        db.from('camp_roles').select('camp, role, signup_id').eq('event_key', k),
        db.from('camp_posts').select('id, camp, kind, auteur_nom, titre, contenu, source, reponse, retenu, created_at').eq('event_key', k).in('kind', ['argument', 'objection']).order('created_at'),
        db.from('camp_votes').select('post_id'),
      ]);
      const appelFait = (pres || []).length > 0;
      const oui = (ins || []).filter((s) => s.reponse === 'oui');
      const camps: string[] = ev.camps?.length ? ev.camps : [...new Set(oui.map((s) => s.camp).filter(Boolean))] as string[];
      const roleDe = new Map<string, string[]>(); for (const r of roles || []) roleDe.set(r.signup_id, [...(roleDe.get(r.signup_id) || []), r.role]);
      const nbVotes = new Map<string, number>(); for (const v of votes || []) nbVotes.set(v.post_id, (nbVotes.get(v.post_id) || 0) + 1);
      const STATP: Record<string, string> = { present: 'Présent·e', absent: 'Absent·e', excuse: 'Excusé·e' };
      d = await DocPdf.creer(`Fiche de séance — ${ev.title}`, `${ev.type} · ${date(ev.starts_at, true)} · ${ev.location}${ev.annule_at ? ' · SÉANCE ANNULÉE' : ''}`, true, auteur);
      const nbP = (pres || []).filter((p) => p.statut === 'present').length;
      d.fiche([['Participants attendus', String(oui.length)], ['Appel', appelFait ? `fait — ${nbP} présent${nbP > 1 ? 's' : ''}` : 'pas encore fait'], ['Camps', camps.join(' / ') || '—'], ['Capacité', ev.capacity ? String(ev.capacity) : 'libre']]);
      if (ev.description) { d.titreSection('Sujet et présentation'); d.texte(ev.description); d.espace(); }
      // Participants : après l'appel, la fiche reflète les présences réelles
      if (appelFait) {
        d.titreSection(`Participants — après l'appel (${(pres || []).length})`);
        const lignes = [...(pres || [])].sort((a, b) => (a.camp || '').localeCompare(b.camp || '') || `${a.nom}`.localeCompare(`${b.nom}`, 'fr'));
        d.tableau(['Participant·e', 'Classe', 'Camp', 'Présence', 'Rôles / arguments'], [0.26, 0.14, 0.14, 0.15, 0.31],
          lignes.map((p) => [{ t: `${p.prenom} ${p.nom}`, gras: true }, p.classe || '—', p.camp || '—', { t: STATP[p.statut] || p.statut, couleur: p.statut === 'present' ? C.vert : p.statut === 'absent' ? C.rouge : C.gris }, [(p.roles || []).join(', '), p.arguments_retenus ? `${p.arguments_retenus} arg. retenu${p.arguments_retenus > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || '—']));
      } else {
        d.titreSection(`Participants attendus (${oui.length})`);
        d.texte("L'appel n'a pas encore été fait : cette liste sera mise à jour avec les présences réelles après l'appel.", '', 9); d.espace(6);
        const lignes = [...oui].sort((a, b) => (a.camp || '').localeCompare(b.camp || '') || a.nom.localeCompare(b.nom, 'fr'));
        d.tableau(['Participant·e', 'Classe', 'Camp', 'Rôle prévu', 'Présence'], [0.28, 0.15, 0.15, 0.24, 0.18],
          lignes.map((s) => [{ t: `${s.prenom} ${s.nom}`, gras: true }, s.classe || '—', s.camp || '—', (roleDe.get(s.id) || []).join(', ') || '—', '☐'.replace('☐', '[   ]')]));
      }
      // Fiche de chaque camp : arguments préparés
      for (const camp of camps) {
        d.page();
        const membres = (appelFait ? (pres || []).filter((p) => p.camp === camp).map((p) => `${p.prenom} ${p.nom}`) : oui.filter((s) => s.camp === camp).map((s) => `${s.prenom} ${s.nom}${roleDe.get(s.id) ? ` (${roleDe.get(s.id)!.join(', ')})` : ''}`));
        d.titreSection(`Camp « ${camp} »`, C.rouge);
        d.texte(membres.length ? membres.join(' · ') : 'Aucun participant dans ce camp.', '', 9.5); d.espace(10);
        const args = (posts || []).filter((p) => p.camp === camp && p.kind === 'argument').sort((a, b) => Number(b.retenu) - Number(a.retenu) || (nbVotes.get(b.id) || 0) - (nbVotes.get(a.id) || 0));
        const obj = (posts || []).filter((p) => p.camp === camp && p.kind === 'objection');
        d.titreSection(`Arguments (${args.length})`);
        if (!args.length) d.texte(null, 'Aucun argument préparé dans la salle de ce camp.');
        args.forEach((a, i) => {
          d.place(40);
          d.texte(`${i + 1}. ${a.titre || a.contenu.slice(0, 80)}${a.retenu ? '   [RETENU]' : ''}`, '', 10.5);
          if (a.titre) d.texte(a.contenu, '', 9.5, 14);
          d.texte(`Proposé par ${a.auteur_nom} · ${nbVotes.get(a.id) || 0} vote${(nbVotes.get(a.id) || 0) > 1 ? 's' : ''}${a.source ? ` · Source : ${a.source}` : ''}`, '', 8, 14);
          d.espace(8);
        });
        if (obj.length) {
          d.espace(4); d.titreSection(`Objections anticipées de l'autre camp (${obj.length})`);
          obj.forEach((o, i) => { d.place(30); d.texte(`${i + 1}. ${o.titre || ''} ${o.contenu}`.trim(), '', 9.5); if (o.reponse) d.texte(`Réponse prévue : ${o.reponse}`, '', 9, 14); d.espace(6); });
        }
      }
      fichier = `fiche-seance-${slug(ev.title)}-${String(ev.starts_at).slice(0, 10)}.pdf`; quoi = `la fiche de la séance « ${ev.title} »`;
    }

    else if (b.type === 'membres') {
      const [{ data: adh }, { data: profs }, { data: pres }] = await Promise.all([
        db.from('adhesions').select('user_id, email, created_at').not('user_id', 'is', null),
        db.from('profiles').select('id, prenom, nom, niveau, classe_num, classe, role, poste, banni, telephone, created_at'),
        db.from('presences').select('user_id, statut'),
      ]);
      const pm = new Map((profs || []).map((p) => [p.id, p]));
      const seances = new Map<string, number>(); for (const p of pres || []) if (p.statut === 'present' && p.user_id) seances.set(p.user_id, (seances.get(p.user_id) || 0) + 1);
      const vus = new Set<string>();
      const liste = (adh || []).filter((a) => pm.has(a.user_id) && !vus.has(a.user_id) && vus.add(a.user_id)).map((a) => ({ ...pm.get(a.user_id), email: a.email, adhesion: a.created_at }))
        .sort((x: any, y: any) => `${x.nom} ${x.prenom}`.localeCompare(`${y.nom} ${y.prenom}`, 'fr'));
      const bureau = liste.filter((m: any) => m.role === 'bureau' || m.role === 'admin' || m.poste);
      d = await DocPdf.creer('Liste des membres', `${liste.length} membre${liste.length > 1 ? 's' : ''} au ${date(new Date().toISOString())}`, true, auteur);
      const niv = (n: string) => liste.filter((m: any) => m.niveau === n).length;
      d.fiche([['Membres', String(liste.length)], ['Membres du bureau', String(bureau.length)], ['Secondes / Premières', `${niv('Seconde')} / ${niv('Première')}`], ['Terminales', String(niv('Terminale'))]]);
      d.titreSection('Bureau');
      d.tableau(['Nom', 'Fonction', 'Classe', 'Email', 'Téléphone'], [0.2, 0.22, 0.13, 0.29, 0.16], bureau.map((m: any) => [{ t: `${m.prenom} ${m.nom}`, gras: true }, m.poste || (m.role === 'admin' ? 'Administrateur' : 'Bureau'), classeDe(m), m.email, m.telephone || '—']), 'Aucun membre du bureau.');
      d.titreSection('Tous les membres');
      d.tableau(['N°', 'Nom', 'Classe', 'Adhésion', 'Séances', 'Email', 'Téléphone'], [0.06, 0.2, 0.12, 0.14, 0.08, 0.26, 0.14],
        liste.map((m: any, i) => [String(i + 1), { t: `${m.prenom} ${m.nom}${m.banni ? ' (suspendu)' : ''}`, gras: true, couleur: m.banni ? C.rouge : C.texte }, classeDe(m), date(m.adhesion), String(seances.get(m.id) || 0), m.email, m.telephone || '—']));
      fichier = `membres-parlement-jpv-${new Date().toISOString().slice(0, 10)}.pdf`; quoi = `la liste des membres (${liste.length})`;
    }

    else if (b.type === 'sondage') {
      const { data: s } = await db.from('sondages').select('*').eq('id', b.id).maybeSingle();
      if (!s) return err(404, 'Sondage introuvable.');
      const { data: rep } = await db.from('sondage_reponses').select('choix').eq('sondage', s.id);
      const n = (rep || []).length, compte = s.options.map((_: string, i: number) => (rep || []).filter((r) => r.choix.includes(i)).length);
      const max = Math.max(0, ...compte);
      d = await DocPdf.creer('Résultats du sondage', s.question, false, auteur);
      d.fiche([['Réponses', String(n)], ['Type', s.multiple ? 'Plusieurs choix possibles' : 'Un seul choix'], ['Créé le', date(s.created_at, true)], ['Date limite', s.fin ? date(s.fin, true) : 'aucune']]);
      d.titreSection('Résultats');
      s.options.forEach((o: string, i: number) => d.barre(o, compte[i], n, `${compte[i]} · ${pc(compte[i], n)}`, compte[i] === max && max > 0));
      if (s.multiple) d.texte('Plusieurs choix possibles : les pourcentages sont calculés sur le nombre de répondants.', '', 8.5);
      fichier = `sondage-${slug(s.question)}.pdf`; quoi = `les résultats du sondage « ${s.question} »`;
    }

    else if (b.type === 'sortie') {
      const { data: s } = await db.from('sorties').select('*').eq('id', b.id).maybeSingle();
      if (!s) return err(404, 'Sortie introuvable.');
      const { data: ins } = await db.from('sortie_inscrits').select('user_id, statut, autorisation_recue, created_at').eq('sortie', s.id).order('created_at');
      const ids = (ins || []).map((i) => i.user_id);
      const { data: profs } = ids.length ? await db.from('profiles').select('id, prenom, nom, niveau, classe_num, classe, telephone').in('id', ids) : { data: [] as any[] };
      const pm = new Map((profs || []).map((p) => [p.id, p]));
      const inscrits = (ins || []).filter((i) => i.statut === 'inscrit'), attente = (ins || []).filter((i) => i.statut === 'attente');
      d = await DocPdf.creer(`Sortie — ${s.titre}`, `${date(s.quand, true)} · ${s.lieu}${s.annule_at ? ' · SORTIE ANNULÉE' : ''}`, true, auteur);
      d.fiche([['Inscrits', `${inscrits.length}${s.places ? ' / ' + s.places : ''}`], ["Liste d'attente", String(attente.length)], ['Rendez-vous', s.rdv || '—'], ['Retour', s.retour || '—'], ['Autorisations reçues', s.autorisation ? `${inscrits.filter((i) => i.autorisation_recue).length} / ${inscrits.length}` : 'non requises'], ['Inscriptions jusqu\'au', s.limite ? date(s.limite, true) : '—']]);
      const ligne = (i: any, n: number) => { const p = pm.get(i.user_id) || {}; return [String(n + 1), { t: `${p.prenom || ''} ${p.nom || ''}`, gras: true }, classeDe(p), p.telephone || '—', s.autorisation ? (i.autorisation_recue ? { t: 'Reçue', couleur: C.vert } : { t: 'Manquante', couleur: C.rouge }) : '—', '[   ]']; };
      d.titreSection(`Participants (${inscrits.length})`);
      d.tableau(['N°', 'Élève', 'Classe', 'Téléphone', 'Autorisation', 'Présent'], [0.07, 0.3, 0.15, 0.18, 0.16, 0.14], inscrits.map(ligne), 'Aucun inscrit.');
      if (attente.length) { d.titreSection(`Liste d'attente (${attente.length})`); d.tableau(['N°', 'Élève', 'Classe', 'Téléphone', 'Autorisation', ''], [0.07, 0.3, 0.15, 0.18, 0.16, 0.14], attente.map(ligne)); }
      fichier = `sortie-${slug(s.titre)}.pdf`; quoi = `la liste de la sortie « ${s.titre} »`;
    }

    else if (b.type === 'compte-rendu') {
      const { data: ev } = await db.from('events').select('*').eq('id', b.id).maybeSingle();
      if (!ev) return err(404, 'Séance introuvable.');
      const k = String(ev.id);
      const [{ data: ins }, { data: pres }, { data: posts }, { data: vo }] = await Promise.all([
        db.from('event_signups').select('prenom, nom, classe, camp, reponse, user_id').eq('event_key', k),
        db.from('presences').select('prenom, nom, classe, statut, camp, roles, arguments_retenus, user_id').eq('event_key', k),
        db.from('camp_posts').select('camp, auteur_nom, titre, contenu, retenu, kind').eq('event_key', k).eq('kind', 'argument').eq('retenu', true).order('created_at'),
        db.from('votes_orateur').select('orateur').eq('event_key', k),
      ]);
      const appel = (pres || []).length > 0;
      const presents = appel ? (pres || []).filter((p) => p.statut === 'present') : [];
      const absents = appel ? (pres || []).filter((p) => p.statut !== 'present') : [];
      const camps: string[] = ev.camps?.length ? ev.camps : [...new Set((pres || []).map((p) => p.camp).filter(Boolean))] as string[];
      const nomDe = new Map<string, string>(); for (const p of [...(ins || []), ...(pres || [])]) if (p.user_id) nomDe.set(p.user_id, `${p.prenom} ${p.nom}`);
      const voix = new Map<string, number>(); for (const v of vo || []) voix.set(v.orateur, (voix.get(v.orateur) || 0) + 1);
      const classement = [...voix.entries()].sort((a, b) => b[1] - a[1]);
      const totalVo = (vo || []).length;
      d = await DocPdf.creer(`Compte rendu — ${ev.title}`, `${ev.type} · ${date(ev.starts_at, true)} · ${ev.location}${ev.annule_at ? ' · SÉANCE ANNULÉE' : ''}`, true, auteur);
      d.fiche([['Présents', appel ? String(presents.length) : "appel non fait"], ['Absents / excusés', appel ? String(absents.length) : '—'], ['Camps', camps.join(' / ') || '—'], ['Arguments retenus', String((posts || []).length)], ['Votes meilleur orateur', String(totalVo)]]);
      d.titreSection('Motion débattue'); d.texte(ev.title, '', 12); if (ev.description) { d.espace(4); d.texte(ev.description, '', 9.5); } d.espace();
      if (ev.annule_at) { d.titreSection('Séance annulée', C.rouge); d.texte(ev.annule_motif || 'Aucun motif indiqué.'); d.espace(); }
      d.titreSection('Intervenants');
      const interv = (appel ? presents : (ins || []).filter((s) => s.reponse === 'oui')).filter((p: any) => p.camp || (p.roles || []).length);
      d.tableau(['Intervenant·e', 'Classe', 'Camp', 'Rôles'], [0.32, 0.16, 0.2, 0.32], interv.sort((a: any, b: any) => (a.camp || '').localeCompare(b.camp || '')).map((p: any) => [{ t: `${p.prenom} ${p.nom}`, gras: true }, p.classe || '—', p.camp || '—', (p.roles || []).join(', ') || '—']), 'Aucun intervenant enregistré.');
      d.titreSection('Arguments retenus');
      if (!(posts || []).length) d.texte(null, 'Aucun argument marqué comme retenu.');
      for (const camp of camps) {
        const a = (posts || []).filter((x) => x.camp === camp); if (!a.length) continue;
        d.place(30); d.texte(`Camp « ${camp} »`, '', 11); d.espace(3);
        a.forEach((x, i) => { d.place(30); d.texte(`${i + 1}. ${x.titre || x.contenu.slice(0, 90)}`, '', 10, 10); if (x.titre) d.texte(x.contenu, '', 9, 22); d.texte(`par ${x.auteur_nom}`, '', 8, 22); d.espace(5); });
        d.espace(4);
      }
      d.titreSection('Résultat du vote — meilleur orateur');
      if (!classement.length) d.texte(null, 'Aucun vote enregistré.');
      classement.slice(0, 8).forEach(([id, n], i) => d.barre(nomDe.get(id) || 'Membre', n, totalVo, `${n} voix · ${pc(n, totalVo)}`, i === 0));
      d.page();
      d.titreSection(`Présents (${presents.length})`);
      d.tableau(['Nom', 'Classe', 'Camp'], [0.45, 0.25, 0.3], presents.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((p) => [{ t: `${p.prenom} ${p.nom}`, gras: true }, p.classe || '—', p.camp || '—']), appel ? 'Aucun présent.' : "L'appel n'a pas été fait.");
      d.titreSection(`Absents et excusés (${absents.length})`);
      d.tableau(['Nom', 'Classe', 'Statut'], [0.45, 0.25, 0.3], absents.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((p) => [{ t: `${p.prenom} ${p.nom}`, gras: true }, p.classe || '—', { t: p.statut === 'excuse' ? 'Excusé·e' : 'Absent·e', couleur: p.statut === 'excuse' ? C.gris : C.rouge }]), 'Aucun absent.');
      fichier = `compte-rendu-${slug(ev.title)}-${String(ev.starts_at).slice(0, 10)}.pdf`; quoi = `le compte rendu de « ${ev.title} »`;
    }

    else if (b.type === 'pv-election') {
      const { data: e } = await db.from('elections').select('*').eq('id', b.id).maybeSingle();
      if (!e) return err(404, 'Élection introuvable.');
      if (!e.publiee) return err(400, 'Les résultats de cette élection ne sont pas encore publiés.');
      const [{ data: cands }, { count: nbV }, { count: nbM }, { data: bur }] = await Promise.all([
        db.from('election_candidats').select('nom, voix').eq('election_id', e.id).order('voix', { ascending: false }),
        db.from('election_votants').select('*', { count: 'exact', head: true }).eq('election_id', e.id),
        db.from('adhesions').select('*', { count: 'exact', head: true }).not('user_id', 'is', null),
        db.from('profiles').select('prenom, nom, poste, role').in('role', ['admin', 'bureau']),
      ]);
      const exprimes = (cands || []).reduce((a, c) => a + c.voix, 0), blancs = e.blancs || 0, total = exprimes + blancs;
      const max = Math.max(0, ...(cands || []).map((c) => c.voix)); const g = (cands || []).filter((c) => c.voix === max && max > 0);
      d = await DocPdf.creer("Procès-verbal d'élection", `${e.titre}${e.poste ? ` — poste de ${e.poste}` : ''}`, false, auteur);
      d.texte(`Le scrutin électronique organisé par le Parlement JPV (lycée Jean-Pierre Vernant, Sèvres) pour l'élection « ${e.titre} »${e.poste ? ` au poste de ${e.poste}` : ''} s'est tenu du ${date(e.ouverture, true)} au ${date(e.fermeture, true)}. Le vote était secret ; chaque membre ne pouvait voter qu'une fois.`, '', 10.5);
      d.espace(8);
      d.fiche([['Membres inscrits', String(nbM || 0)], ['Votants', String(nbV || 0)], ['Participation', nbM ? pc(nbV || 0, nbM) : '—'], ['Bulletins blancs', String(blancs)], ['Suffrages exprimés', String(exprimes)]]);
      d.titreSection('Voix obtenues');
      d.tableau(['Candidat·e', 'Voix', '% des votes'], [0.55, 0.2, 0.25], (cands || []).map((c) => [{ t: c.nom, gras: c.voix === max && max > 0 }, String(c.voix), pc(c.voix, total)]), 'Aucun candidat.');
      d.titreSection('Proclamation');
      d.texte(g.length === 1 ? `${g[0].nom} est déclaré·e élu·e${e.poste ? ` au poste de ${e.poste}` : ''} avec ${max} voix sur ${total}.` : g.length > 1 ? `Égalité entre ${g.map((x) => x.nom).join(' et ')} (${max} voix chacun·e) : le bureau statue selon le règlement.` : 'Aucun candidat élu.', '', 11);
      d.espace(16);
      d.texte(`Fait à Sèvres, le ${date(new Date().toISOString())}.`, '', 10); d.espace(12);
      d.titreSection('Signatures');
      const signataires = (bur || []).filter((p) => p.poste).slice(0, 3);
      const lignesS = (signataires.length ? signataires : [{ prenom: '', nom: '', poste: 'Président·e du Parlement' }, { prenom: '', nom: '', poste: 'Secrétaire du bureau' }] as any[])
        .map((p: any) => [{ t: `${p.prenom} ${p.nom}`.trim() || '……………………', gras: true }, p.poste, '\n\n\n']);
      d.tableau(['Nom', 'Fonction', 'Signature'], [0.32, 0.3, 0.38], lignesS);
      d.espace(6); d.texte('Signature du professeur référent : ……………………………………', '', 10);
      fichier = `pv-election-${slug(e.titre)}.pdf`; quoi = `le PV de l'élection « ${e.titre} »`;
    }

    else if (['rapport-annuel', 'registre', 'assiduite', 'recueil'].includes(b.type)) {
      const now = new Date(); const an = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      const debut = new Date(Date.UTC(an, 8, 1)).toISOString(); const annee = `${an}-${an + 1}`;

      if (b.type === 'registre') {
        const { data: j } = await db.from('journal').select('at, acteur_nom, categorie, resume').gte('at', debut).order('at', { ascending: true }).limit(3000);
        d = await DocPdf.creer('Registre des décisions du bureau', `Année ${annee} · ${(j || []).length} entrées`, true, auteur);
        d.texte("Extrait du journal de l'espace bureau : chaque action du bureau y est enregistrée automatiquement, datée et attribuée.", '', 9); d.espace(6);
        const cats = new Map<string, any[]>(); for (const l of j || []) cats.set(l.categorie || 'Divers', [...(cats.get(l.categorie || 'Divers') || []), l]);
        d.fiche([...cats.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([c, l]) => [c, String(l.length)] as [string, string]));
        d.titreSection('Registre chronologique');
        d.tableau(['Date', 'Par', 'Rubrique', 'Décision / action'], [0.15, 0.18, 0.15, 0.52], (j || []).map((l) => [date(l.at, true), l.acteur_nom || '—', l.categorie || '—', l.resume]), 'Aucune entrée cette année.');
        fichier = `registre-bureau-${annee}.pdf`; quoi = 'le registre des décisions du bureau';
      }

      else if (b.type === 'recueil') {
        const [{ data: mo }, { data: mv }, { data: id }] = await Promise.all([
          db.from('motions').select('id, texte, contexte, auteur_nom, statut, created_at').order('created_at', { ascending: false }),
          db.from('motion_votes').select('motion_id'),
          db.from('idees').select('texte, categorie, statut, reponse, created_at').order('created_at', { ascending: false }),
        ]);
        const nv = new Map<string, number>(); for (const v of mv || []) nv.set(v.motion_id, (nv.get(v.motion_id) || 0) + 1);
        const st = (x: string) => ({ proposee: 'Proposée', retenue: 'Retenue', debattue: 'Débattue', refusee: 'Refusée', rejetee: 'Rejetée', nouvelle: 'Nouvelle', en_cours: 'En cours', faite: 'Réalisée', realisee: 'Réalisée', acceptee: 'Acceptée' } as Record<string, string>)[x] || x || '—';
        d = await DocPdf.creer('Recueil des motions et des idées', `${(mo || []).length} motions · ${(id || []).length} idées · au ${date(now.toISOString())}`, false, auteur);
        d.titreSection(`Motions proposées (${(mo || []).length})`);
        d.tableau(['Motion', 'Proposée par', 'Soutiens', 'Statut', 'Date'], [0.46, 0.17, 0.1, 0.12, 0.15], (mo || []).sort((a, b) => (nv.get(b.id) || 0) - (nv.get(a.id) || 0)).map((m) => [{ t: m.texte, gras: true }, m.auteur_nom || '—', String(nv.get(m.id) || 0), st(m.statut), date(m.created_at)]), 'Aucune motion.');
        d.titreSection(`Boîte à idées (${(id || []).length})`);
        d.texte("Les idées sont anonymes.", '', 8.5); d.espace(4);
        d.tableau(['Idée', 'Catégorie', 'Statut', 'Réponse du bureau'], [0.4, 0.14, 0.12, 0.34], (id || []).map((i) => [i.texte, i.categorie || '—', st(i.statut), i.reponse || '—']), 'Aucune idée.');
        fichier = `recueil-motions-idees-${now.toISOString().slice(0, 10)}.pdf`; quoi = 'le recueil des motions et des idées';
      }

      else {
        const [{ data: ev }, { data: adh }, { data: profs }, { data: pres }, { data: el }, { data: evo }, { data: so }, { data: sd }, { data: sdr }, { data: tn }] = await Promise.all([
          db.from('events').select('id, title, type, starts_at, annule_at').eq('published', true).gte('starts_at', debut).lte('starts_at', now.toISOString()).order('starts_at'),
          db.from('adhesions').select('user_id, created_at').not('user_id', 'is', null),
          db.from('profiles').select('id, prenom, nom, niveau, classe_num, classe, banni'),
          db.from('presences').select('event_key, user_id, statut'),
          db.from('elections').select('id, titre, fermeture, publiee').gte('created_at', debut),
          db.from('election_votants').select('election_id, user_id'),
          db.from('sorties').select('id, titre, quand, annule_at').gte('quand', debut),
          db.from('sondages').select('id').gte('created_at', debut),
          db.from('sondage_reponses').select('sondage, user_id'),
          db.from('tournois').select('nom, statut, champion').gte('created_at', debut),
        ]);
        const pm = new Map((profs || []).map((p) => [p.id, p]));
        const vus = new Set<string>(); const membres = (adh || []).filter((a) => pm.has(a.user_id) && !vus.has(a.user_id) && vus.add(a.user_id));
        const tenues = (ev || []).filter((e) => !e.annule_at);
        const cles = new Set(tenues.map((e) => String(e.id)));
        const presA = (pres || []).filter((p) => cles.has(p.event_key));
        const electionsA = (el || []); const idsEl = new Set(electionsA.map((e) => e.id));
        const votesEl = (evo || []).filter((v) => idsEl.has(v.election_id));

        if (b.type === 'assiduite') {
          const sp = new Map<string, { p: number; a: number; e: number }>();
          for (const p of presA) if (p.user_id) { const o = sp.get(p.user_id) || { p: 0, a: 0, e: 0 }; p.statut === 'present' ? o.p++ : p.statut === 'excuse' ? o.e++ : o.a++; sp.set(p.user_id, o); }
          const ve = new Map<string, number>(); for (const v of votesEl) ve.set(v.user_id, (ve.get(v.user_id) || 0) + 1);
          const sondA = new Set((sd || []).map((x) => x.id)); const vs = new Map<string, number>(); for (const r of sdr || []) if (sondA.has(r.sondage)) vs.set(r.user_id, (vs.get(r.user_id) || 0) + 1);
          const lignes = membres.map((a) => { const p: any = pm.get(a.user_id); const o = sp.get(a.user_id) || { p: 0, a: 0, e: 0 }; return { p, o, ve: ve.get(a.user_id) || 0, vs: vs.get(a.user_id) || 0 }; })
            .sort((x, y) => y.o.p - x.o.p || `${x.p.nom}`.localeCompare(`${y.p.nom}`, 'fr'));
          d = await DocPdf.creer('Assiduité des membres', `Année ${annee} · ${tenues.length} séance${tenues.length > 1 ? 's' : ''} · ${electionsA.length} élection${electionsA.length > 1 ? 's' : ''} · ${(sd || []).length} sondage${(sd || []).length > 1 ? 's' : ''}`, true, auteur);
          d.texte("Présences relevées à l'appel des séances, participation aux élections et aux sondages depuis le 1er septembre. Le taux de présence porte sur les séances où le membre était inscrit à l'appel.", '', 9); d.espace(6);
          d.tableau(['Membre', 'Classe', 'Présent', 'Absent', 'Excusé', 'Taux', 'Élections', 'Sondages'], [0.24, 0.12, 0.09, 0.09, 0.09, 0.1, 0.13, 0.14],
            lignes.map(({ p, o, ve: e, vs: s2 }) => { const t = o.p + o.a + o.e; const taux = t ? Math.round((o.p / t) * 100) : null; return [{ t: `${p.prenom} ${p.nom}`, gras: true }, classeDe(p), String(o.p), { t: String(o.a), couleur: o.a >= 3 ? C.rouge : C.texte }, String(o.e), taux === null ? '—' : { t: `${taux} %`, couleur: taux < 50 ? C.rouge : taux >= 80 ? C.vert : C.texte }, `${e} / ${electionsA.length}`, `${s2} / ${(sd || []).length}`]; }), 'Aucun membre.');
          fichier = `assiduite-membres-${annee}.pdf`; quoi = "l'assiduité des membres";
        } else {
          const nbP = presA.filter((p) => p.statut === 'present').length;
          const seancesAvecAppel = new Set(presA.map((p) => p.event_key)).size;
          const nouveaux = membres.filter((a) => a.created_at >= debut).length;
          const partEl = electionsA.length && membres.length ? Math.round((votesEl.length / (electionsA.length * membres.length)) * 100) : null;
          const parSeance = new Map<string, number>(); for (const p of presA) if (p.statut === 'present') parSeance.set(p.event_key, (parSeance.get(p.event_key) || 0) + 1);
          const top = tenues.map((e) => ({ e, n: parSeance.get(String(e.id)) || 0 })).sort((a, b) => b.n - a.n)[0];
          const niv = (n: string) => membres.filter((a) => (pm.get(a.user_id) as any)?.niveau === n).length;
          d = await DocPdf.creer("Rapport d'activité", `Parlement JPV · année ${annee} · au ${date(now.toISOString())}`, false, auteur);
          d.fiche([['Membres', String(membres.length)], ['Nouveaux membres', String(nouveaux)], ['Séances tenues', String(tenues.length)], ['Présence moyenne', seancesAvecAppel ? `${Math.round(nbP / seancesAvecAppel)} par séance` : '—'], ['Élections', String(electionsA.length)], ['Participation aux élections', partEl === null ? '—' : `${partEl} %`], ['Sondages', String((sd || []).length)], ['Sorties', String((so || []).filter((x) => !x.annule_at).length)]]);
          d.titreSection('Composition');
          const tm = membres.length; ['Seconde', 'Première', 'Terminale'].forEach((n) => d.barre(n, niv(n), tm, `${niv(n)} · ${pc(niv(n), tm)}`));
          d.titreSection('Faits marquants');
          const faits: string[] = [];
          if (top && top.n) faits.push(`Séance la plus suivie : « ${top.e.title} » (${top.n} présents, ${date(top.e.starts_at)}).`);
          for (const e of electionsA.filter((x) => x.publiee)) faits.push(`Élection « ${e.titre} » (clôture le ${date(e.fermeture)}).`);
          for (const t of tn || []) faits.push(`Tournoi « ${t.nom} »${t.champion && pm.get(t.champion) ? ` — champion·ne : ${(pm.get(t.champion) as any).prenom} ${(pm.get(t.champion) as any).nom}` : ''}.`);
          for (const x of (so || []).filter((x) => !x.annule_at)) faits.push(`Sortie « ${x.titre} » (${date(x.quand)}).`);
          if (!faits.length) d.texte(null, 'Rien à signaler pour le moment.'); else faits.forEach((f) => { d.place(20); d.texte(`- ${f}`, '', 10); });
          d.titreSection('Séances de l\'année');
          d.tableau(['Date', 'Séance', 'Type', 'Présents'], [0.16, 0.5, 0.18, 0.16], (ev || []).map((e) => [date(e.starts_at), { t: e.title + (e.annule_at ? ' (annulée)' : ''), gras: !e.annule_at }, e.type, e.annule_at ? '—' : String(parSeance.get(String(e.id)) ?? '—')]), 'Aucune séance pour le moment.');
          fichier = `rapport-activite-${annee}.pdf`; quoi = "le rapport d'activité";
        }
      }
    }

    else return err(400, 'Type de document inconnu.');
  } catch (e) { console.error(e); return err(500, 'Le PDF n\'a pas pu être généré.'); }
  return { pdf: await d!.finir(), fichier, quoi };

}

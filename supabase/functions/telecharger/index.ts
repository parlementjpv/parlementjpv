import { admin, json, cors, userFromRequest, readJson, journal } from '../_shared/lib.ts';
import { DocPdf, C, date, initiale, slug } from '../_shared/pdf.ts';
import { certificatPdf } from '../_shared/certificat.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

// Rubrique « Téléchargements » : documents PDF du bureau, réservés aux administrateurs.
// Types : candidatures, election, seance, membres, sondage, sortie.
const STATC: Record<string, string> = { nouvelle: 'Nouvelle', en_cours: 'En cours', acceptee: 'Acceptée', refusee: 'Refusée' };
const ELEVES = ['Seconde', 'Première', 'Terminale'];
const classeDe = (p: any) => p?.niveau ? (ELEVES.includes(p.niveau) ? `${p.niveau}${p.classe_num ? ' ' + p.classe_num : ''}` : p.niveau === 'Personnel' ? 'Personnel du lycée' : p.niveau) : (p?.classe || '—');
const pc = (n: number, t: number) => t ? `${Math.round((n / t) * 100)} %` : '0 %';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  if (me.profile?.role !== 'admin') return json(req, 403, { error: 'Réservé aux administrateurs.' });
  const b = await readJson(req) || {};
  const db = admin();
  const auteur = [me.profile?.prenom, me.profile?.nom].filter(Boolean).join(' ') || 'un administrateur';
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
      const certs: (Uint8Array | null)[] = [];
      for (let i = 0; i < ids.length; i += 4) certs.push(...(await Promise.all(ids.slice(i, i + 4).map((id) => certificatPdf(id).then((c) => c?.pdf || null).catch(() => null)))));
      let n = 0;
      for (const c of certs) { if (!c) continue; const src = await PDFDocument.load(c); for (const pg of await recueil.copyPages(src, src.getPageIndices())) recueil.addPage(pg); n++; }
      if (!n) return json(req, 404, { error: 'Aucun certificat à générer.' });
      const out = await recueil.save();
      await journal(me.user.id, 'Téléchargements', `a téléchargé en PDF l'intégralité des certificats de membre (${n})`);
      return new Response(out, { headers: { ...cors(req), 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="certificats-membres-parlement-jpv-${new Date().toISOString().slice(0, 10)}.pdf"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' } });
    }

    if (b.type === 'candidatures') {
      let q = db.from('candidatures').select('*').order('created_at', { ascending: false });
      if (b.filtre === 'ouvertes') q = q.in('statut', ['nouvelle', 'en_cours']);
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
      fichier = `candidatures-parlement-jpv-${new Date().toISOString().slice(0, 10)}.pdf`; quoi = `les candidatures (${liste.length})`;
    }

    else if (b.type === 'election') {
      const { data: e } = await db.from('elections').select('*').eq('id', b.id).maybeSingle();
      if (!e) return json(req, 404, { error: 'Élection introuvable.' });
      if (!e.publiee) return json(req, 400, { error: 'Les résultats de cette élection ne sont pas encore publiés.' });
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
      if (!ev) return json(req, 404, { error: 'Séance introuvable.' });
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
      if (!s) return json(req, 404, { error: 'Sondage introuvable.' });
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
      if (!s) return json(req, 404, { error: 'Sortie introuvable.' });
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

    else return json(req, 400, { error: 'Type de document inconnu.' });
  } catch (e) { console.error(e); return json(req, 500, { error: 'Le PDF n\'a pas pu être généré.' }); }

  const pdf = await d!.finir();
  await journal(me.user.id, 'Téléchargements', `a téléchargé en PDF ${quoi}`);
  return new Response(pdf, { headers: { ...cors(req), 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fichier}"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' } });
});

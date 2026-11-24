import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import { admin, json, cors, userFromRequest, readJson, journal, SITE } from '../_shared/lib.ts';

// Dossier de candidature en PDF (A4) — réservé au bureau, marqué confidentiel.
// Les coordonnées (email, téléphone) n'apparaissent que pour les administrateurs.
const nuit = rgb(15 / 255, 31 / 255, 75 / 255), rouge = rgb(214 / 255, 40 / 255, 57 / 255), gris = rgb(0.36, 0.39, 0.46), clair = rgb(0.95, 0.96, 0.97), ligne = rgb(0.85, 0.86, 0.89);
const W = 595.28, H = 841.89, M = 56;
const STAT: Record<string, string> = { nouvelle: 'Nouvelle', en_cours: "En cours d'examen", acceptee: 'Acceptée', refusee: 'Refusée' };
const date = (d: string | null, h = false) => d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', ...(h ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Europe/Paris' }) : '—';

/** Remplace les caractères que la police PDF standard ne sait pas afficher. */
function propre(f: PDFFont, t: string) {
  const map: Record<string, string> = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '·': '-', ' ': ' ', ' ': ' ', 'œ': 'oe', 'Œ': 'OE' };
  let out = '';
  for (const ch of String(t ?? '').replace(/\r/g, '')) {
    const c = map[ch] ?? ch;
    try { f.encodeText(c); out += c; } catch { out += ''; }
  }
  return out;
}
function couper(f: PDFFont, t: string, s: number, max: number) {
  const lignes: string[] = [];
  for (const para of propre(f, t).split('\n')) {
    if (!para.trim()) { lignes.push(''); continue; }
    let cur = '';
    for (const mot of para.split(/\s+/)) {
      const essai = cur ? cur + ' ' + mot : mot;
      if (f.widthOfTextAtSize(essai, s) <= max) cur = essai;
      else { if (cur) lignes.push(cur); cur = mot; while (f.widthOfTextAtSize(cur, s) > max) { let i = cur.length; while (i > 1 && f.widthOfTextAtSize(cur.slice(0, i), s) > max) i--; lignes.push(cur.slice(0, i)); cur = cur.slice(i); } }
    }
    lignes.push(cur);
  }
  return lignes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré : recharge la page.' });
  if (!['bureau', 'admin'].includes(me.profile?.role)) return json(req, 403, { error: 'Réservé au bureau.' });
  const estAdmin = me.profile?.role === 'admin';
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b?.id || ''))) return json(req, 400, { error: 'Requête invalide' });
  const db = admin();
  const { data: c } = await db.from('candidatures').select('*').eq('id', b.id).maybeSingle();
  if (!c) return json(req, 404, { error: 'Candidature introuvable.' });
  let tel: string | null = null;
  if (estAdmin && c.user_id) { const { data: p } = await db.from('profiles').select('telephone').eq('id', c.user_id).maybeSingle(); tel = p?.telephone || null; }
  const auteur = [me.profile?.prenom, me.profile?.nom].filter(Boolean).join(' ') || 'le bureau';

  const doc = await PDFDocument.create();
  const nom = `${c.prenom} ${c.nom}`;
  doc.setTitle(`Candidature confidentielle — ${nom}`); doc.setAuthor('Parlement JPV — bureau'); doc.setSubject('Document confidentiel à usage interne du bureau'); doc.setCreator('parlementjpv.fr'); doc.setKeywords(['confidentiel']);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), it = await doc.embedFont(StandardFonts.HelveticaOblique);
  let logo: any = null; try { logo = await doc.embedPng(await (await fetch(`${SITE}/assets/img/logo-certificat.png`)).arrayBuffer()); } catch { /* */ }

  const pages: PDFPage[] = [];
  let pg!: PDFPage, y = 0;
  const nouvellePage = () => {
    pg = doc.addPage([W, H]); pages.push(pg);
    // filigrane
    pg.drawText('CONFIDENTIEL', { x: 120, y: 300, size: 74, font: bold, color: rouge, opacity: 0.06, rotate: degrees(35) });
    // bandeau tricolore + en-tête
    const t = W / 3; pg.drawRectangle({ x: 0, y: H - 8, width: t, height: 8, color: nuit }); pg.drawRectangle({ x: 2 * t, y: H - 8, width: t, height: 8, color: rouge });
    if (logo) pg.drawImage(logo, { x: M, y: H - 78, width: 46, height: 46 });
    pg.drawText('PARLEMENT JPV', { x: M + 58, y: H - 50, size: 14, font: bold, color: nuit });
    pg.drawText(propre(reg, 'Lycée Jean-Pierre Vernant · Sèvres — Bureau'), { x: M + 58, y: H - 66, size: 9, font: reg, color: gris });
    const lab = 'CONFIDENTIEL', lw = bold.widthOfTextAtSize(lab, 9) + 18;
    pg.drawRectangle({ x: W - M - lw, y: H - 62, width: lw, height: 20, color: rouge });
    pg.drawText(lab, { x: W - M - lw + 9, y: H - 55.5, size: 9, font: bold, color: rgb(1, 1, 1) });
    pg.drawLine({ start: { x: M, y: H - 92 }, end: { x: W - M, y: H - 92 }, thickness: 1, color: ligne });
    y = H - 120;
  };
  const place = (h: number) => { if (y - h < 80) nouvellePage(); };

  nouvellePage();
  pg.drawText('Dossier de candidature', { x: M, y, size: 24, font: bold, color: nuit }); y -= 26;
  const sous = c.type === 'bureau' ? `Candidature au bureau — ${c.poste || 'tout poste'}` : 'Candidature membre';
  pg.drawText(propre(reg, sous), { x: M, y, size: 12, font: reg, color: rouge }); y -= 30;

  // Bloc identité
  const champs: [string, string][] = [
    ['Candidat·e', nom], ['Classe', c.classe || '—'], ['Poste visé', c.type === 'bureau' ? (c.poste || 'Tout poste') : 'Membre'],
    ['Déposée le', date(c.created_at, true)], ['Statut', STAT[c.statut] || c.statut], ['Décision le', c.decided_at ? date(c.decided_at, true) : '—'],
  ];
  if (estAdmin) { champs.push(['Email', c.email || '—']); champs.push(['Téléphone', tel || '—']); }
  const rows = Math.ceil(champs.length / 2), hb = rows * 34 + 18;
  pg.drawRectangle({ x: M, y: y - hb + 12, width: W - 2 * M, height: hb, color: clair });
  pg.drawRectangle({ x: M, y: y - hb + 12, width: 4, height: hb, color: nuit });
  champs.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2), x = M + 18 + col * ((W - 2 * M) / 2), yy = y - 8 - row * 34;
    pg.drawText(propre(reg, k.toUpperCase()), { x, y: yy, size: 7.5, font: bold, color: gris });
    pg.drawText(propre(bold, v).slice(0, 48), { x, y: yy - 14, size: 11, font: bold, color: nuit });
  });
  y -= hb + 18;

  const section = (titre: string, texte: string | null, vide = 'Non renseigné.') => {
    place(60);
    pg.drawText(propre(bold, titre), { x: M, y, size: 13, font: bold, color: nuit }); y -= 6;
    pg.drawLine({ start: { x: M, y }, end: { x: M + 40, y }, thickness: 2, color: rouge }); y -= 18;
    const lignes = couper(texte ? reg : it, texte || vide, 10.5, W - 2 * M);
    for (const l of lignes) { place(16); pg.drawText(l, { x: M, y, size: 10.5, font: texte ? reg : it, color: texte ? rgb(0.14, 0.19, 0.31) : gris }); y -= 15.5; }
    y -= 14;
  };
  section(c.type === 'bureau' ? 'Motivation et projet pour le poste' : 'Motivation', c.motivation);
  section('Expérience', c.experience);
  section('Disponibilités', c.disponibilites);
  section('Message du bureau au candidat', c.note_bureau, 'Aucun message.');

  // Pieds de page sur toutes les pages
  const genere = `Généré le ${date(new Date().toISOString(), true)} par ${auteur}`;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 58 }, end: { x: W - M, y: 58 }, thickness: 0.8, color: ligne });
    p.drawText(propre(bold, 'Document confidentiel — usage interne du bureau du Parlement JPV.'), { x: M, y: 44, size: 7.5, font: bold, color: rouge });
    p.drawText(propre(reg, 'Contient des données personnelles d\'élève : ne pas diffuser, ne pas transférer, supprimer après usage (RGPD).'), { x: M, y: 33, size: 7.5, font: reg, color: gris });
    p.drawText(propre(reg, genere), { x: M, y: 22, size: 7.5, font: reg, color: gris });
    const pn = `Page ${i + 1} / ${pages.length}`; p.drawText(pn, { x: W - M - reg.widthOfTextAtSize(pn, 7.5), y: 22, size: 7.5, font: reg, color: gris });
  });

  const pdf = await doc.save();
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fichier = `candidature-confidentielle-${slug(nom)}${c.poste ? '-' + slug(c.poste) : ''}.pdf`;
  await journal(me.user.id, 'Membres', `a téléchargé le dossier PDF de la candidature de ${nom}${c.poste ? ` (${c.poste})` : ''}`);
  return new Response(pdf, { headers: { ...cors(req), 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fichier}"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' } });
});

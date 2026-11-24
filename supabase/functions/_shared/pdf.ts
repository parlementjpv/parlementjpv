import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type RGB } from 'npm:pdf-lib@1.17.1';
import { SITE } from './lib.ts';

// Mise en page commune des documents PDF du bureau (A4 portrait), identité du Parlement JPV.
export const C = { nuit: rgb(15 / 255, 31 / 255, 75 / 255), rouge: rgb(214 / 255, 40 / 255, 57 / 255), gris: rgb(0.36, 0.39, 0.46), clair: rgb(0.95, 0.96, 0.97), ligne: rgb(0.85, 0.86, 0.89), texte: rgb(0.14, 0.19, 0.31), vert: rgb(0.07, 0.55, 0.29), blanc: rgb(1, 1, 1) };
const W = 595.28, H = 841.89, M = 50;
export const date = (d: string | null | undefined, h = false) => d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', ...(h ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Europe/Paris' }) : '—';
export const initiale = (prenom: string, nom: string) => `${prenom || ''} ${nom ? nom.trim()[0].toUpperCase() + '.' : ''}`.trim();
export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export class DocPdf {
  doc!: PDFDocument; reg!: PDFFont; bold!: PDFFont; it!: PDFFont; logo: any = null;
  pages: PDFPage[] = []; pg!: PDFPage; y = 0;
  constructor(public titre: string, public sousTitre: string, public confidentiel = true, public auteur = 'le bureau') {}
  static async creer(titre: string, sousTitre: string, confidentiel: boolean, auteur: string) {
    const d = new DocPdf(titre, sousTitre, confidentiel, auteur);
    d.doc = await PDFDocument.create();
    d.doc.setTitle(`${titre}${sousTitre ? ' — ' + sousTitre : ''}`); d.doc.setAuthor('Parlement JPV — bureau'); d.doc.setCreator('parlementjpv.fr');
    if (confidentiel) d.doc.setSubject('Document confidentiel à usage interne du bureau');
    d.reg = await d.doc.embedFont(StandardFonts.Helvetica); d.bold = await d.doc.embedFont(StandardFonts.HelveticaBold); d.it = await d.doc.embedFont(StandardFonts.HelveticaOblique);
    try { d.logo = await d.doc.embedPng(await (await fetch(`${SITE}/assets/img/logo-certificat.png`)).arrayBuffer()); } catch { /* */ }
    d.page(true);
    return d;
  }
  /** Remplace les caractères que la police standard ne sait pas afficher. */
  p(f: PDFFont, t: unknown) {
    const map: Record<string, string> = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ', 'œ': 'oe', 'Œ': 'OE', '✓': 'v' };
    let out = ''; for (const ch of String(t ?? '').replace(/\r/g, '')) { const c = map[ch] ?? ch; try { f.encodeText(c); out += c; } catch { /* ignoré */ } }
    return out;
  }
  couper(f: PDFFont, t: string, s: number, max: number) {
    const lignes: string[] = [];
    for (const para of this.p(f, t).split('\n')) {
      if (!para.trim()) { lignes.push(''); continue; }
      let cur = '';
      for (const mot of para.split(/\s+/)) {
        const e = cur ? cur + ' ' + mot : mot;
        if (f.widthOfTextAtSize(e, s) <= max) cur = e;
        else { if (cur) lignes.push(cur); cur = mot; while (f.widthOfTextAtSize(cur, s) > max && cur.length > 1) { let i = cur.length; while (i > 1 && f.widthOfTextAtSize(cur.slice(0, i), s) > max) i--; lignes.push(cur.slice(0, i)); cur = cur.slice(i); } }
      }
      lignes.push(cur);
    }
    return lignes;
  }
  page(premiere = false) {
    this.pg = this.doc.addPage([W, H]); this.pages.push(this.pg);
    if (this.confidentiel) this.pg.drawText('CONFIDENTIEL', { x: 95, y: 250, size: 66, font: this.bold, color: C.rouge, opacity: 0.05, rotate: degrees(35) });
    const t = W / 3; this.pg.drawRectangle({ x: 0, y: H - 8, width: t, height: 8, color: C.nuit }); this.pg.drawRectangle({ x: 2 * t, y: H - 8, width: t, height: 8, color: C.rouge });
    if (this.logo) this.pg.drawImage(this.logo, { x: M, y: H - 74, width: 42, height: 42 });
    this.pg.drawText('PARLEMENT JPV', { x: M + 54, y: H - 48, size: 13, font: this.bold, color: C.nuit });
    this.pg.drawText(this.p(this.reg, 'Lycée Jean-Pierre Vernant · Sèvres — Bureau'), { x: M + 54, y: H - 63, size: 8.5, font: this.reg, color: C.gris });
    if (this.confidentiel) { const lab = 'CONFIDENTIEL', lw = this.bold.widthOfTextAtSize(lab, 8.5) + 16; this.pg.drawRectangle({ x: W - M - lw, y: H - 60, width: lw, height: 19, color: C.rouge }); this.pg.drawText(lab, { x: W - M - lw + 8, y: H - 54, size: 8.5, font: this.bold, color: C.blanc }); }
    this.pg.drawLine({ start: { x: M, y: H - 86 }, end: { x: W - M, y: H - 86 }, thickness: 1, color: C.ligne });
    this.y = H - 112;
    if (premiere) {
      this.pg.drawText(this.p(this.bold, this.titre), { x: M, y: this.y, size: 22, font: this.bold, color: C.nuit }); this.y -= 22;
      if (this.sousTitre) for (const l of this.couper(this.reg, this.sousTitre, 11.5, W - 2 * M)) { this.pg.drawText(l, { x: M, y: this.y, size: 11.5, font: this.reg, color: C.rouge }); this.y -= 15; }
      this.y -= 14;
    } else {
      this.pg.drawText(this.p(this.reg, `${this.titre} (suite)`), { x: M, y: this.y, size: 10, font: this.reg, color: C.gris }); this.y -= 22;
    }
  }
  place(h: number) { if (this.y - h < 78) this.page(); }
  /** Bloc de chiffres ou d'informations clés (2 colonnes). */
  fiche(champs: [string, string][]) {
    const rows = Math.ceil(champs.length / 2), hb = rows * 32 + 14; this.place(hb + 10);
    this.pg.drawRectangle({ x: M, y: this.y - hb + 12, width: W - 2 * M, height: hb, color: C.clair });
    this.pg.drawRectangle({ x: M, y: this.y - hb + 12, width: 4, height: hb, color: C.nuit });
    champs.forEach(([k, v], i) => {
      const x = M + 16 + (i % 2) * ((W - 2 * M) / 2), yy = this.y - 6 - Math.floor(i / 2) * 32;
      this.pg.drawText(this.p(this.bold, k.toUpperCase()), { x, y: yy, size: 7, font: this.bold, color: C.gris });
      const val = this.p(this.bold, v); let vv = val; while (vv.length > 3 && this.bold.widthOfTextAtSize(vv, 10.5) > (W - 2 * M) / 2 - 26) vv = vv.slice(0, -2);
      this.pg.drawText(vv === val ? vv : vv + '…'.replace('…', '...'), { x, y: yy - 13, size: 10.5, font: this.bold, color: C.nuit });
    });
    this.y -= hb + 14;
  }
  titreSection(t: string, couleur: RGB = C.nuit) {
    this.place(50);
    this.pg.drawText(this.p(this.bold, t), { x: M, y: this.y, size: 13, font: this.bold, color: couleur }); this.y -= 6;
    this.pg.drawLine({ start: { x: M, y: this.y }, end: { x: M + 40, y: this.y }, thickness: 2, color: C.rouge }); this.y -= 16;
  }
  texte(t: string | null, vide = 'Non renseigné.', taille = 10, retrait = 0) {
    const f = t ? this.reg : this.it;
    for (const l of this.couper(f, t || vide, taille, W - 2 * M - retrait)) { this.place(15); this.pg.drawText(l, { x: M + retrait, y: this.y, size: taille, font: f, color: t ? C.texte : C.gris }); this.y -= taille * 1.45; }
  }
  espace(h = 10) { this.y -= h; }
  /** Tableau avec en-tête répété à chaque page. largeurs en fraction de la largeur utile. */
  tableau(entetes: string[], largeurs: number[], lignes: (string | { t: string; gras?: boolean; couleur?: RGB })[][], vide = 'Aucune donnée.') {
    const L = W - 2 * M, xs: number[] = []; let acc = M; for (const w of largeurs) { xs.push(acc); acc += w * L; }
    const ws = largeurs.map((w) => w * L);
    const entete = () => {
      this.place(40);
      this.pg.drawRectangle({ x: M, y: this.y - 6, width: L, height: 20, color: C.nuit });
      entetes.forEach((e, i) => this.pg.drawText(this.p(this.bold, e), { x: xs[i] + 6, y: this.y, size: 8, font: this.bold, color: C.blanc }));
      this.y -= 22;
    };
    entete();
    if (!lignes.length) { this.texte(null, vide); this.y -= 6; return; }
    lignes.forEach((row, ri) => {
      const cells = row.map((c, i) => { const o = typeof c === 'string' ? { t: c } : c; const f = o.gras ? this.bold : this.reg; return { f, lignes: this.couper(f, o.t ?? '', 9, ws[i] - 12), couleur: o.couleur || C.texte }; });
      const h = Math.max(...cells.map((c) => c.lignes.length)) * 12 + 8;
      if (this.y - h < 78) { this.page(); entete(); }
      if (ri % 2 === 1) this.pg.drawRectangle({ x: M, y: this.y - h + 10, width: L, height: h, color: C.clair });
      cells.forEach((c, i) => c.lignes.forEach((l, li) => this.pg.drawText(l, { x: xs[i] + 6, y: this.y - li * 12, size: 9, font: c.f, color: c.couleur })));
      this.y -= h;
    });
    this.pg.drawLine({ start: { x: M, y: this.y + 8 }, end: { x: W - M, y: this.y + 8 }, thickness: 0.6, color: C.ligne });
    this.y -= 10;
  }
  /** Barre horizontale (résultats). */
  barre(label: string, valeur: number, total: number, detail: string, gagnant = false) {
    this.place(34);
    const L = W - 2 * M, pc = total ? valeur / total : 0;
    this.pg.drawText(this.p(gagnant ? this.bold : this.reg, label), { x: M, y: this.y, size: 10.5, font: gagnant ? this.bold : this.reg, color: C.nuit });
    const d = this.p(this.bold, detail); this.pg.drawText(d, { x: W - M - this.bold.widthOfTextAtSize(d, 10), y: this.y, size: 10, font: this.bold, color: gagnant ? C.rouge : C.nuit });
    this.pg.drawRectangle({ x: M, y: this.y - 12, width: L, height: 7, color: C.clair });
    if (pc > 0) this.pg.drawRectangle({ x: M, y: this.y - 12, width: Math.max(2, L * pc), height: 7, color: gagnant ? C.rouge : C.nuit });
    this.y -= 30;
  }
  async finir() {
    const genere = `Généré le ${date(new Date().toISOString(), true)} par ${this.auteur}`;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: 56 }, end: { x: W - M, y: 56 }, thickness: 0.8, color: C.ligne });
      if (this.confidentiel) {
        p.drawText(this.p(this.bold, 'Document confidentiel — usage interne du bureau du Parlement JPV.'), { x: M, y: 43, size: 7.5, font: this.bold, color: C.rouge });
        p.drawText(this.p(this.reg, "Contient des données personnelles d'élèves : ne pas diffuser, ne pas transférer, supprimer après usage (RGPD)."), { x: M, y: 32, size: 7.5, font: this.reg, color: C.gris });
      } else p.drawText(this.p(this.reg, 'Parlement JPV · Lycée Jean-Pierre Vernant, Sèvres · parlementjpv.fr'), { x: M, y: 38, size: 7.5, font: this.reg, color: C.gris });
      p.drawText(this.p(this.reg, genere), { x: M, y: 21, size: 7.5, font: this.reg, color: C.gris });
      const pn = `Page ${i + 1} / ${this.pages.length}`; p.drawText(pn, { x: W - M - this.reg.widthOfTextAtSize(pn, 7.5), y: 21, size: 7.5, font: this.reg, color: C.gris });
    });
    return await this.doc.save();
  }
}

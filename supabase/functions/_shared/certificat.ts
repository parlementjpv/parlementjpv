import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import qrcode from 'npm:qrcode-generator@1.4.4';
import { admin, SITE } from './lib.ts';

// Certificat de membre (PDF A4 paysage) : signature manuscrite du membre, signature de la présidence,
// numéro unique et QR code renvoyant vers la page de vérification.
export async function certificatPdf(userId: string): Promise<{ pdf: Uint8Array; nomFichier: string; prenom: string } | null> {
  const db = admin();
  const { data: p } = await db.from('profiles').select('id, prenom, nom, classe, created_at, certificat_code, poste, banni').eq('id', userId).maybeSingle();
  if (!p || p.banni) return null;
  const [{ count: seances }, { data: sig }, { data: pres }] = await Promise.all([
    db.from('presences').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('statut', 'present'),
    db.from('signatures').select('image, signed_at').eq('user_id', userId).maybeSingle(),
    db.from('profiles').select('prenom, nom, poste').ilike('poste', 'Président%').eq('banni', false).limit(1),
  ]);
  const president = pres?.[0];

  const doc = await PDFDocument.create();
  doc.setTitle(`Certificat de membre — ${p.prenom} ${p.nom}`); doc.setAuthor('Parlement JPV'); doc.setCreator('parlementjpv.fr');
  const W = 841.89, H = 595.28;
  const pg = doc.addPage([W, H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), it = await doc.embedFont(StandardFonts.HelveticaOblique);
  const nuit = rgb(15 / 255, 31 / 255, 75 / 255), rouge = rgb(214 / 255, 40 / 255, 57 / 255), gris = rgb(0.35, 0.37, 0.42);

  pg.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: nuit, borderWidth: 4 });
  const tiers = (W - 48) / 3;
  pg.drawRectangle({ x: 24, y: H - 40, width: tiers, height: 16, color: nuit });
  pg.drawRectangle({ x: 24 + 2 * tiers, y: H - 40, width: tiers, height: 16, color: rouge });
  try {
    const logo = await doc.embedPng(await (await fetch(`${SITE}/assets/img/logo-certificat.png`)).arrayBuffer());
    pg.drawImage(logo, { x: 64, y: H - 150, width: 78, height: 78 });
  } catch { /* logo facultatif */ }
  const centre = (t: string, y: number, f = reg, s = 14, c = nuit) => pg.drawText(t, { x: (W - f.widthOfTextAtSize(t, s)) / 2, y, size: s, font: f, color: c });
  pg.drawText('PARLEMENT JPV', { x: 156, y: H - 102, size: 18, font: bold, color: nuit });
  pg.drawText('Lycée Jean-Pierre Vernant, Sèvres', { x: 156, y: H - 124, size: 11, font: reg, color: gris });

  centre('Certificat de membre', H - 205, bold, 40);
  centre('Le bureau du Parlement JPV certifie que', H - 245, reg, 14, gris);
  centre(`${p.prenom} ${p.nom}`, H - 288, bold, 32, rouge);
  const date = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  centre(`${p.classe ? `élève de ${p.classe}, ` : ''}est membre de l'instance depuis le ${date(p.created_at)}`, H - 322, reg, 15);
  const extra = [p.poste ? `${p.poste} du bureau` : '', seances ? `${seances} séance${seances > 1 ? 's' : ''} suivie${seances > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  if (extra) centre(extra, H - 346, reg, 13, gris);

  // Signatures : membre (gauche) et présidence (droite)
  const yLigne = 150;
  pg.drawText('Signature du membre', { x: 70, y: yLigne + 70, size: 10, font: reg, color: gris });
  if (sig?.image) {
    try {
      const img = await doc.embedPng(Uint8Array.from(atob(sig.image.split(',')[1]), (c) => c.charCodeAt(0)));
      const h = 52, w = Math.min(220, (img.width / img.height) * h);
      pg.drawImage(img, { x: 70, y: yLigne + 6, width: w, height: h });
    } catch { /* image illisible : on n'affiche que la mention */ }
    pg.drawText(`Signé électroniquement le ${date(sig.signed_at)}`, { x: 70, y: yLigne - 14, size: 8.5, font: it, color: gris });
  }
  pg.drawLine({ start: { x: 70, y: yLigne }, end: { x: 300, y: yLigne }, thickness: 1.2, color: nuit });

  const now = new Date(), an = now.getFullYear(), annee = now.getMonth() >= 8 ? `${an}-${an + 1}` : `${an - 1}-${an}`;
  pg.drawText(president ? `Présidence ${annee}` : `Pour le bureau, année ${annee}`, { x: 340, y: yLigne + 70, size: 10, font: reg, color: gris });
  pg.drawText(president ? `${president.prenom} ${president.nom}` : 'Le bureau du Parlement JPV', { x: 340, y: yLigne + 10, size: 15, font: bold, color: nuit });
  pg.drawLine({ start: { x: 340, y: yLigne }, end: { x: 560, y: yLigne }, thickness: 1.2, color: nuit });
  pg.drawText(`Fait à Sèvres, le ${date(new Date().toISOString())}`, { x: 70, y: 92, size: 11, font: reg, color: nuit });

  // QR code de vérification
  const url = `${SITE}/verifier?c=${p.certificat_code}`;
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), taille = 112, m = taille / n, x0 = W - 70 - taille, y0 = 62;
  pg.drawRectangle({ x: x0 - 6, y: y0 - 6, width: taille + 12, height: taille + 12, color: rgb(1, 1, 1), borderColor: nuit, borderWidth: 1.5 });
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) pg.drawRectangle({ x: x0 + c * m, y: y0 + taille - (r + 1) * m, width: m + 0.2, height: m + 0.2, color: nuit });
  const lab = 'Scanner pour vérifier';
  pg.drawText(lab, { x: x0 + (taille - reg.widthOfTextAtSize(lab, 8.5)) / 2, y: y0 + taille + 12, size: 8.5, font: reg, color: gris });
  pg.drawText(`Certificat n° ${p.certificat_code}`, { x: 70, y: 70, size: 10, font: bold, color: nuit });
  pg.drawText(`Vérifiable sur ${url.replace(/^https?:\/\//, '')}`, { x: 70, y: 56, size: 9, font: reg, color: gris });

  const slug = `${p.prenom}-${p.nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { pdf: await doc.save(), nomFichier: `certificat-parlement-jpv-${slug}.pdf`, prenom: p.prenom };
}

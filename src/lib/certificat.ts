import type { SupabaseClient } from '@supabase/supabase-js';
import { u } from './url';

// Certificat de membre en PDF, généré dans le navigateur (aucune donnée envoyée ailleurs)
export async function telechargerCertificat(sb: SupabaseClient) {
  const { data: c, error } = await sb.rpc('mon_certificat');
  if (error || !c) throw new Error('Certificat indisponible');
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificat de membre — ${c.prenom} ${c.nom}`); doc.setAuthor('Parlement JPV'); doc.setCreator('parlementjpv.github.io');
  const W = 841.89, H = 595.28; // A4 paysage
  const p = doc.addPage([W, H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const nuit = rgb(0x0f / 255, 0x1f / 255, 0x4b / 255), rouge = rgb(0xd6 / 255, 0x28 / 255, 0x39 / 255), gris = rgb(0.35, 0.37, 0.42);
  // Cadre et bande tricolore
  p.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: nuit, borderWidth: 4 });
  p.drawRectangle({ x: 24, y: H - 40, width: (W - 48) / 3, height: 16, color: nuit });
  p.drawRectangle({ x: 24 + (W - 48) / 3, y: H - 40, width: (W - 48) / 3, height: 16, color: rgb(1, 1, 1) });
  p.drawRectangle({ x: 24 + 2 * (W - 48) / 3, y: H - 40, width: (W - 48) / 3, height: 16, color: rouge });
  // Logo
  try {
    const png = await doc.embedPng(await (await fetch(u('/assets/img/icon-192.png'))).arrayBuffer());
    p.drawImage(png, { x: 64, y: H - 150, width: 78, height: 78 });
  } catch { /* logo facultatif */ }
  const centre = (t: string, y: number, f = reg, s = 14, col = nuit) => p.drawText(t, { x: (W - f.widthOfTextAtSize(t, s)) / 2, y, size: s, font: f, color: col });
  p.drawText('PARLEMENT JPV', { x: 156, y: H - 102, size: 18, font: bold, color: nuit });
  p.drawText('Lycée Jean-Pierre Vernant, Sèvres', { x: 156, y: H - 124, size: 11, font: reg, color: gris });
  centre('Certificat de membre', H - 215, bold, 40, nuit);
  centre('Le bureau du Parlement JPV certifie que', H - 262, reg, 14, gris);
  const nom = `${c.prenom} ${c.nom}`;
  centre(nom, H - 308, bold, 32, rouge);
  const depuis = new Date(c.membre_depuis).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  centre(`${c.classe ? `élève de ${c.classe}, ` : ''}est membre de l'instance depuis le ${depuis}`, H - 345, reg, 15, nuit);
  const extra = [c.poste ? `et occupe le poste de ${c.poste} au bureau` : '', c.seances ? `${c.seances} séance${c.seances > 1 ? 's' : ''} suivie${c.seances > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  if (extra) centre(extra, H - 370, reg, 13, gris);
  // Date, signature, vérification
  const auj = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  p.drawText(`Fait à Sèvres, le ${auj}`, { x: 70, y: 120, size: 12, font: reg, color: nuit });
  const sig = c.president ? `${c.president.prenom} ${c.president.nom}` : 'Le bureau du Parlement JPV';
  p.drawText(c.president ? 'Pour le bureau, la présidence' : 'Pour le bureau', { x: W - 330, y: 132, size: 11, font: reg, color: gris });
  p.drawText(sig, { x: W - 330, y: 112, size: 15, font: bold, color: nuit });
  p.drawLine({ start: { x: W - 330, y: 104 }, end: { x: W - 70, y: 104 }, thickness: 1.5, color: nuit });
  const url = `${location.origin}${u('/verifier')}?c=${c.code}`;
  p.drawText(`Certificat n° ${c.code}`, { x: 70, y: 70, size: 10, font: bold, color: nuit });
  p.drawText(`Vérifiable sur ${url.replace(/^https?:\/\//, '')}`, { x: 70, y: 56, size: 9, font: reg, color: gris });
  const bytes = await doc.save();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = `certificat-parlement-jpv-${(c.prenom + '-' + c.nom).toLowerCase().normalize('NFD').replace(/[^a-z0-9-]+/g, '')}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

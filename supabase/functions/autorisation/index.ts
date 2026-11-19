import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { admin, json, cors, readJson, userFromRequest, SITE } from '../_shared/lib.ts';

// Autorisation parentale pré-remplie (PDF A4) pour une sortie à laquelle le membre est inscrit
const date = (d: string, h = true) => new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...(h ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Europe/Paris' }).replace(':', 'h');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const me = await userFromRequest(req);
  if (!me) return json(req, 401, { error: 'Ta session a expiré.' });
  const b = await readJson(req); const db = admin();
  const { data: i } = await db.from('sortie_inscrits').select('statut, sorties(*)').eq('sortie', b?.sortie).eq('user_id', me.user.id).maybeSingle() as any;
  if (!i) return json(req, 403, { error: 'Tu n\'es pas inscrit·e à cette sortie.' });
  const s = i.sorties, p = me.profile || {};

  const doc = await PDFDocument.create(); doc.setTitle(`Autorisation parentale — ${s.titre}`); doc.setAuthor('Parlement JPV');
  const W = 595.28, H = 841.89, pg = doc.addPage([W, H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const nuit = rgb(15 / 255, 31 / 255, 75 / 255), rouge = rgb(214 / 255, 40 / 255, 57 / 255), gris = rgb(0.35, 0.37, 0.42);
  pg.drawRectangle({ x: 0, y: H - 10, width: W / 3, height: 10, color: nuit }); pg.drawRectangle({ x: 2 * W / 3, y: H - 10, width: W / 3, height: 10, color: rouge });
  try { const logo = await doc.embedPng(await (await fetch(`${SITE}/assets/img/logo-certificat.png`)).arrayBuffer()); pg.drawImage(logo, { x: 50, y: H - 100, width: 56, height: 56 }); } catch { /* facultatif */ }
  pg.drawText('PARLEMENT JPV', { x: 118, y: H - 66, size: 15, font: bold, color: nuit });
  pg.drawText('Lycée Jean-Pierre Vernant, Sèvres', { x: 118, y: H - 84, size: 10, font: reg, color: gris });
  let y = H - 150;
  const t = (s: string, o: { size?: number; font?: typeof reg; color?: typeof nuit; x?: number } = {}) => { pg.drawText(s, { x: o.x ?? 50, y, size: o.size ?? 11, font: o.font ?? reg, color: o.color ?? nuit }); };
  const wrap = (s: string, size = 11, font = reg, max = W - 100) => { const out: string[] = []; let l = ''; for (const w of s.split(/\s+/)) { const c = l ? `${l} ${w}` : w; if (font.widthOfTextAtSize(c, size) > max) { out.push(l); l = w; } else l = c; } if (l) out.push(l); return out; };
  t('Autorisation parentale de sortie', { size: 22, font: bold }); y -= 34;
  const ligne = (k: string, v: string) => { if (!v) return; t(k, { size: 10, color: gris }); for (const l of wrap(v, 11, bold, W - 190)) { t(l, { x: 160, font: bold }); y -= 15; } y -= 3; };
  ligne('Sortie', s.titre); ligne('Date', date(s.quand)); ligne('Lieu', s.lieu); ligne('Rendez-vous', s.rdv); ligne('Retour prévu', s.retour);
  ligne('Élève', `${p.prenom || ''} ${p.nom || ''}${p.classe ? ` — ${p.classe}` : ''}`);
  y -= 14;
  const para = (s: string) => { for (const l of wrap(s)) { t(l); y -= 16; } y -= 8; };
  para(`Je soussigné(e) ..................................................................., responsable légal(e) de l'élève ${p.prenom || ''} ${p.nom || ''}, autorise mon enfant à participer à la sortie « ${s.titre} » organisée par le Parlement JPV le ${date(s.quand, false)}.`);
  para('J\'ai pris connaissance des horaires et du lieu de rendez-vous indiqués ci-dessus. J\'autorise les organisateurs à prendre, en cas d\'urgence, toute mesure rendue nécessaire par l\'état de santé de mon enfant.');
  y -= 6;
  for (const k of ['Téléphone du responsable légal (joignable le jour de la sortie) :', 'Informations utiles (allergie, traitement, etc.) :']) { t(k, { size: 10, color: gris }); y -= 22; pg.drawLine({ start: { x: 50, y }, end: { x: W - 50, y }, thickness: 0.8, color: gris }); y -= 22; }
  y -= 10;
  t('Fait à ............................................, le ........ / ........ / ............'); y -= 40;
  t('Signature du responsable légal', { size: 10, color: gris }); t('Signature de l\'élève', { size: 10, color: gris, x: 330 }); y -= 8;
  pg.drawRectangle({ x: 50, y: y - 80, width: 230, height: 80, borderColor: nuit, borderWidth: 1.2 });
  pg.drawRectangle({ x: 330, y: y - 80, width: 215, height: 80, borderColor: nuit, borderWidth: 1.2 });
  pg.drawRectangle({ x: 0, y: 40, width: W, height: 44, color: rgb(0.91, 0.92, 0.94) });
  pg.drawText(`À rapporter signée à un membre du bureau${s.limite ? ` avant le ${date(s.limite, false)}` : ' avant la sortie'}.`, { x: 50, y: 66, size: 11, font: bold, color: rouge });
  pg.drawText('Sans autorisation signée, l\'élève ne pourra pas participer à la sortie.', { x: 50, y: 50, size: 9, font: reg, color: gris });
  const slug = s.titre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return new Response(await doc.save(), { headers: { ...cors(req), 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="autorisation-${slug}.pdf"`, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Cache-Control': 'no-store' } });
});

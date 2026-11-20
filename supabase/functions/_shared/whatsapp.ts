import { esc, layout, button } from './lib.ts';

/** Lien qui ouvre WhatsApp avec le texte déjà écrit (il reste à choisir le groupe). */
export const lienWhatsApp = (texte: string) => `https://wa.me/?text=${encodeURIComponent(texte)}`;

/** Email au bureau contenant le message prêt à coller dans le groupe WhatsApp. */
export function mailWhatsApp(intro: string, texte: string) {
  return layout({ title: 'Message à publier sur WhatsApp', body:
    `<p>${intro}</p>
     <p>Copie le texte ci-dessous et colle-le dans le groupe WhatsApp du Parlement, ou touche le bouton depuis ton téléphone : WhatsApp s'ouvre avec le message déjà écrit, il ne reste qu'à choisir le groupe.</p>
     <div style="background:#e8f8ee;border:2px solid #25d366;border-radius:10px;padding:16px 18px;margin:18px 0;white-space:pre-wrap;font-size:15px;line-height:1.5;">${esc(texte)}</div>
     <p style="margin:24px 0;"><a href="${lienWhatsApp(texte)}" style="display:inline-block;background:#25d366;color:#ffffff;font-weight:800;padding:14px 26px;text-decoration:none;border-radius:8px;">Publier sur WhatsApp</a></p>
     <p style="color:#555;font-size:13px;">Email automatique envoyé à l'adresse du Parlement.</p>` });
}

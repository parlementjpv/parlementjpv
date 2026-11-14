// Après le build : pages de redirection pour les anciennes adresses du site v1 (*.html),
// déjà connues de Google. Redirection immédiate + lien canonique vers la nouvelle page.
import { writeFile } from 'node:fs/promises';

const origin = (process.env.SITE_ORIGIN || 'https://parlementjpv.github.io').replace(/\/$/, '');
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
const map = {
  'qui-sommes-nous.html': 'qui-sommes-nous/', 'institution.html': 'institution/', 'rejoindre.html': 'rejoindre/',
  'contact.html': 'contact/', 'actualites.html': 'actualites/', 'charte.html': 'charte/', 'galerie.html': 'galerie/',
  'photos.html': 'galerie/', 'media.html': 'medias/', 'rapports.html': 'rapports/', 'mentions-legales.html': 'mentions-legales/',
  'politique-confidentialite.html': 'confidentialite/', 'jpv-mun.html': '', 'Espace-bureau.html': 'bureau/', 'Espace-bourse.html': '',
};
for (const [from, to] of Object.entries(map)) {
  const url = `${origin}${base}/${to}`;
  await writeFile(`dist/${from}`, `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Parlement JPV</title>
<link rel="canonical" href="${url}"><meta http-equiv="refresh" content="0; url=${url}">
<script>location.replace(${JSON.stringify(url)} + location.hash)</script></head>
<body><p>Cette page a déménagé : <a href="${url}">${url}</a></p></body></html>`);
}
console.log(`${Object.keys(map).length} redirections d'anciennes adresses`);

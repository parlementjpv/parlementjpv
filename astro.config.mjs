import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.SITE_ORIGIN || 'https://parlementjpv.fr',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  integrations: [sitemap({
    filter: (p) => !/\/(verifier|compte|bureau|profil|motions|elections|salle|connexion|inscription|mot-de-passe-oublie|nouveau-mot-de-passe|mentions-legales|confidentialite|newsletter\/(lire|merci|erreur|desinscription))\/?$/.test(p),
    lastmod: new Date(),
    serialize(item) {
      const path = new URL(item.url).pathname.replace(/^\/[^/]+\//, '/');
      item.changefreq = /\/(evenement|agenda|actualites)\/$/.test(path) ? 'daily' : 'weekly';
      item.priority = path === '/' ? 1.0 : /\/(rejoindre|evenement|candidature|agenda)\/$/.test(path) ? 0.9 : 0.6;
      return item;
    },
  })],
});

import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.SITE_ORIGIN || 'https://parlementjpv.github.io',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  integrations: [sitemap({ filter: (p) => !/\/(compte|bureau|connexion|inscription|mot-de-passe|nouveau-mot|newsletter\/(lire|merci|erreur|desinscription))/.test(p) })],
});

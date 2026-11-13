import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://parlementjpv.github.io',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap({ filter: (p) => !/\/(compte|bureau|connexion|inscription|mot-de-passe|nouveau-mot|newsletter\/(lire|merci|erreur|desinscription))/.test(p) })],
});

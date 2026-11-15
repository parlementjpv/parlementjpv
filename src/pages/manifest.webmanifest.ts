import type { APIRoute } from 'astro';

// Manifeste de l'application installable : elle s'ouvre directement sur « Mon espace »
export const GET: APIRoute = () => {
  const b = import.meta.env.BASE_URL.replace(/\/$/, '');
  return new Response(JSON.stringify({
    name: 'Parlement JPV',
    short_name: 'Parlement JPV',
    description: 'Ton espace membre du Parlement JPV : séances, votes, profil d\'orateur et notifications.',
    id: `${b}/compte/`,
    start_url: `${b}/compte/?app=1`,
    scope: `${b}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f1f4b',
    theme_color: '#0f1f4b',
    lang: 'fr',
    icons: [
      { src: `${b}/assets/img/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${b}/assets/img/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${b}/assets/img/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), { headers: { 'Content-Type': 'application/manifest+json' } });
};

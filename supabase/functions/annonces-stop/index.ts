import { admin, SITE } from '../_shared/lib.ts';

// Lien « ne plus recevoir les annonces de séances » présent dans chaque email d'annonce
Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get('t') || '';
  let ok = false;
  if (/^[0-9a-f-]{36}$/i.test(t)) {
    const { data } = await admin().from('adhesions').update({ annonces: false }).eq('desabo_token', t).select('id');
    ok = !!data?.length;
  }
  return new Response(null, { status: 303, headers: { Location: ok ? `${SITE}/newsletter/desinscription?annonces=1` : `${SITE}/newsletter/erreur`, 'Cache-Control': 'no-store' } });
});

import { admin, sendMail, layout, esc, FROM } from '../_shared/lib.ts';

// Sauvegarde hebdomadaire : toutes les tables + la liste des comptes (sans mots de passe),
// compressée et envoyée en pièce jointe à l'adresse du Parlement. Déclenchée par pg_cron avec un secret.
const TABLES = ['profiles', 'adhesions', 'events', 'event_signups', 'presences', 'camp_posts', 'camp_votes', 'camp_roles',
  'candidatures', 'motions', 'motion_votes', 'elections', 'election_candidats', 'election_votants',
  'newsletter_subscribers', 'newsletters', 'contact_messages', 'member_messages', 'bureau_taches', 'bureau_messages', 'bureau_notes', 'reglages'];

Deno.serve(async (req) => {
  const secret = Deno.env.get('BACKUP_SECRET');
  if (!secret || req.headers.get('x-sauvegarde') !== secret) return new Response('Interdit', { status: 403 });
  const db = admin();
  const dump: Record<string, unknown[]> = {};
  const compte: Record<string, number> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select('*').range(from, from + 999);
      if (error) { console.error(t, error.message); break; }
      rows.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    dump[t] = rows; compte[t] = rows.length;
  }
  // Comptes : identité et dates uniquement (jamais les mots de passe)
  const users: unknown[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error(error.message); break; }
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, email_confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at, banned_until: (u as any).banned_until, user_metadata: u.user_metadata })));
    if (data.users.length < 1000) break;
  }
  dump['auth_users'] = users; compte['auth_users'] = users.length;

  const date = new Date().toISOString().slice(0, 10);
  const brut = new TextEncoder().encode(JSON.stringify({ format: 'parlement-jpv-sauvegarde-v1', date: new Date().toISOString(), tables: dump }));
  const gz = new Uint8Array(await new Response(new Blob([brut]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const total = Object.values(compte).reduce((a, n) => a + n, 0);
  await sendMail({
    from: FROM, to: Deno.env.get('BACKUP_EMAIL') || Deno.env.get('SMTP_USER')!, subject: `Sauvegarde du site — ${date}`,
    html: layout({ title: `Sauvegarde du ${date}`, body: `<p>Sauvegarde automatique de la base du site : <strong>${total}</strong> lignes, ${(gz.length / 1024).toFixed(0)} Ko compressés.</p>
      <table style="border-collapse:collapse;font-size:14px;">${Object.entries(compte).map(([t, n]) => `<tr><td style="padding:2px 16px 2px 0;">${esc(t)}</td><td style="text-align:right;">${n}</td></tr>`).join('')}</table>
      <p style="color:#555;font-size:13px;">Garde cet email : il contient des données personnelles d'élèves, ne le transfère pas. Pour restaurer, transmets le fichier à la personne qui gère le site.</p>` }),
    attachments: [{ filename: `sauvegarde-parlement-jpv-${date}.json.gz`, content: gz, contentType: 'application/gzip' }],
  });
  return new Response(JSON.stringify({ ok: true, lignes: total, ko: Math.round(gz.length / 1024) }), { headers: { 'Content-Type': 'application/json' } });
});

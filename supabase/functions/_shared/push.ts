import webpush from 'npm:web-push@3.6.7';
import { admin, SITE } from './lib.ts';

// Notifications push (Web Push, clés VAPID dans les secrets Supabase).
// Gratuit : les messages passent par les services push d'Apple, Google ou Mozilla selon l'appareil.
let pret = false;
function init() {
  if (pret) return true;
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return false;
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:contact@parlementjpv.fr', pub, priv);
  return (pret = true);
}

export type Notif = { titre: string; texte: string; url?: string; tag?: string };

/** Envoie une notification à tous les appareils des utilisateurs donnés. Ne lève jamais d'erreur. */
export async function pushUtilisateurs(userIds: (string | null | undefined)[], n: Notif) {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  if (!ids.length || !init()) return { envoyes: 0 };
  const db = admin();
  const { data: abos } = await db.from('push_abonnements').select('id, endpoint, p256dh, auth').in('user_id', ids);
  const payload = JSON.stringify({ title: n.titre, body: n.texte, url: n.url || `${SITE}/compte`, tag: n.tag });
  let envoyes = 0; const perimes: string[] = [];
  await Promise.all((abos || []).map(async (a) => {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, { TTL: 86400, urgency: 'normal' });
      envoyes++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) perimes.push(a.id); else console.error('push', code, (e as Error).message);
    }
  }));
  if (perimes.length) await db.from('push_abonnements').delete().in('id', perimes);
  return { envoyes };
}

/** Tous les membres actifs (non bannis) ayant au moins un appareil abonné. */
export async function pushTous(n: Notif) {
  const db = admin();
  const { data } = await db.from('push_abonnements').select('user_id, profiles!inner(banni)').eq('profiles.banni', false);
  return pushUtilisateurs((data || []).map((x: { user_id: string }) => x.user_id), n);
}

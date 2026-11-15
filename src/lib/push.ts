import type { SupabaseClient } from '@supabase/supabase-js';
import { u } from './url';

// Clé publique VAPID (la clé privée est dans les secrets Supabase)
const VAPID_PUBLIC = 'BL9siJt9RFdKUnCsy3kB1IK3i1m9M8enHkKrNMP-Kl2mE2lhyVe-3H04IBJWh3IdNM4R1h9P0lPO4_074g4t6WE';

export const estApp = () => document.documentElement.classList.contains('app');
export const estIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const pushSupporte = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function swRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration(u('/'))) || navigator.serviceWorker.register(u('/sw.js'), { scope: u('/') });
}

function cle(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** État des notifications sur cet appareil */
export async function etatPush(): Promise<'actif' | 'inactif' | 'bloque' | 'ios-installer' | 'non-supporte'> {
  if (estIOS() && !estApp()) return 'ios-installer';
  if (!pushSupporte()) return 'non-supporte';
  if (Notification.permission === 'denied') return 'bloque';
  const reg = await navigator.serviceWorker.getRegistration(u('/'));
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'actif' : 'inactif';
}

/** Demande l'autorisation, abonne l'appareil et l'enregistre pour l'utilisateur connecté */
export async function activerPush(sb: SupabaseClient) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'bloque' : 'refuse');
  const reg = await swRegistration();
  if (!reg) throw new Error('non-supporte');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle(VAPID_PUBLIC) }));
  const j = sub.toJSON();
  const { error } = await sb.rpc('push_enregistrer', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_appareil: navigator.userAgent.slice(0, 180) });
  if (error) throw error;
}

export async function desactiverPush(sb: SupabaseClient) {
  const reg = await navigator.serviceWorker.getRegistration(u('/'));
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await sb.from('push_abonnements').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
}

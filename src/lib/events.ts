import { getSupabase, supabaseConfigured } from './supabase';
import { u } from './url';

export interface Ev {
  id: string;
  title: string;
  type: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  description: string | null;
  capacity: number | null;
  camps: string[];
}
export interface Counts { oui: number; non: number; par_camp: Record<string, number> }

export const EVENT_TYPES = ['Débat', 'Conférence', 'Atelier', 'Concours', 'Visite', 'Séance', 'Événement'];

const tz = { timeZone: 'Europe/Paris' } as const;
export const fmt = {
  day: (s: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', ...tz }).format(new Date(s)),
  month: (s: string) => new Intl.DateTimeFormat('fr-FR', { month: 'long', ...tz }).format(new Date(s)),
  monShort: (s: string) => new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', ...tz }).format(new Date(s)).replace('.', ''),
  long: (s: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...tz }).format(new Date(s)),
  hour: (s: string) => new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', ...tz }).format(new Date(s)),
  short: (s: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', ...tz }).format(new Date(s)),
};
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
export const when = (e: Ev) => `${fmt.hour(e.starts_at)}${e.ends_at ? ` – ${fmt.hour(e.ends_at)}` : ''}`;

/** Événements à venir (ou en cours) créés par le bureau. */
export async function fetchUpcoming(): Promise<Ev[]> {
  if (!supabaseConfigured) return [];
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const { data } = await getSupabase().from('events').select('*').eq('published', true).gte('starts_at', since).order('starts_at');
  return (data as Ev[]) || [];
}
export async function fetchPast(): Promise<Ev[]> {
  if (!supabaseConfigured) return [];
  const { data } = await getSupabase().from('events').select('*').eq('published', true).lt('starts_at', new Date().toISOString()).order('starts_at', { ascending: false });
  return (data as Ev[]) || [];
}
export async function fetchCounts(): Promise<Record<string, Counts>> {
  if (!supabaseConfigured) return {};
  const { data } = await getSupabase().rpc('event_counts');
  const out: Record<string, Counts> = {};
  (data || []).forEach((c: any) => (out[c.event_key] = { oui: Number(c.oui), non: Number(c.non), par_camp: c.par_camp || {} }));
  return out;
}

/** Même rendu que le composant EventList (date en gros chiffres). */
export function eventRow(e: Ev, opts: { counts?: Counts; respond?: boolean } = {}) {
  const n = opts.counts?.oui || 0;
  const full = e.capacity ? n >= e.capacity : false;
  return `<article class="event">
    <div class="event-date"><b>${fmt.day(e.starts_at)}</b><span>${esc(fmt.monShort(e.starts_at))}</span></div>
    <div>
      <div class="flex" style="gap:8px;"><span class="pill">${esc(e.type)}</span>${n ? `<span class="small muted">${n} participant${n > 1 ? 's' : ''}${e.capacity ? ` / ${e.capacity}` : ''}</span>` : ''}</div>
      <h3>${esc(e.title)}</h3>
      <div class="meta">${when(e)} · ${esc(e.location)}</div>
      ${e.camps?.length ? `<div class="meta">Camps tirés au sort : ${e.camps.map(esc).join(' / ')}</div>` : ''}
      ${opts.respond === false ? '' : `<a class="btn ${full ? 'btn-outline' : 'btn-primary'} btn-sm mt-1" href="${u('/evenement')}?e=${e.id}">${full ? 'Complet — voir' : 'Je réponds'}</a>`}
    </div>
  </article>`;
}

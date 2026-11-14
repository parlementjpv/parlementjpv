import { esc, SITE } from './lib.ts';

export type Ev = { id: string; title: string; type: string; starts_at: string; ends_at: string | null; location: string; description: string | null; camps: string[] | null; capacity: number | null; places_par_camp: number | null };

const tz = { timeZone: 'Europe/Paris' } as const;
export const quand = (ev: Ev) => {
  const jour = new Date(ev.starts_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...tz });
  const h = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...tz }).replace(':', 'h');
  return `${jour}, ${h(ev.starts_at)}${ev.ends_at ? ` – ${h(ev.ends_at)}` : ''}`;
};
export const lienEvenement = (ev: Ev) => `${SITE}/evenement?e=${ev.id}`;

/** Bloc récapitulatif de l'événement pour les emails */
export function fiche(ev: Ev, camp?: string | null) {
  const ligne = (k: string, v: string) => `<tr><td style="padding:6px 14px 6px 0;color:#555;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:6px 0;font-weight:600;">${v}</td></tr>`;
  return `<table style="border-collapse:collapse;border-top:3px solid #0f1f4b;border-bottom:3px solid #0f1f4b;width:100%;margin:18px 0;font-size:15px;">
    ${ligne('Quoi', `${esc(ev.type)} — ${esc(ev.title)}`)}
    ${ligne('Quand', esc(quand(ev)))}
    ${ligne('Où', esc(ev.location))}
    ${camp ? ligne('Ton camp', `<span style="color:#d62839;">${esc(camp)}</span> (tiré au sort)`) : ev.camps?.length ? ligne('Camps', esc(ev.camps.join(' · ')) + (ev.places_par_camp ? ` — ${ev.places_par_camp} places par camp` : '')) : ''}
    ${!camp && ev.capacity ? ligne('Places', String(ev.capacity)) : ''}
  </table>${ev.description ? `<p style="white-space:pre-wrap;">${esc(ev.description)}</p>` : ''}`;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { postJSON } from './newsletter';

// Tableau de bord en tête de l'espace bureau : l'essentiel d'un coup d'œil, chaque carte ouvre la rubrique.
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const jour = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dans = (d: string) => { const j = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000); return j <= 0 ? "aujourd'hui" : j === 1 ? 'demain' : `dans ${j} jours`; };

function carte(id: string, tab: string, titre: string) {
  return `<button type="button" class="tdb-c" id="${id}" data-ouvre="${tab}"><span class="tdb-t">${titre}</span><span class="tdb-v">…</span><span class="tdb-d small"></span></button>`;
}
function remplir(id: string, valeur: string, detail: string, alerte = false) {
  const c = document.getElementById(id); if (!c) return;
  (c.querySelector('.tdb-v') as HTMLElement).textContent = valeur;
  (c.querySelector('.tdb-d') as HTMLElement).innerHTML = detail;
  c.classList.toggle('tdb-alerte', alerte);
}

export async function initTableauBord(sb: SupabaseClient, me: { id: string }, isAdmin: boolean) {
  const zone = $('tdb');
  zone.innerHTML = carte('tdbSeance', 'inscr', 'Prochaine séance') + carte('tdbTaches', 'entre', 'Mes tâches') + carte('tdbReunion', 'reunions', 'Prochaine réunion du bureau')
    + carte('tdbCand', 'cand', 'Candidatures à traiter') + carte('tdbSond', 'sondages', 'Sondages ouverts') + (isAdmin ? carte('tdbMail', 'boite', 'Mails non lus') : '');
  zone.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest('.tdb-c') as HTMLElement | null; if (!c) return;
    document.querySelector<HTMLButtonElement>(`.bu-tile[data-tab="${c.dataset.ouvre}"]`)?.click();
    if (c.dataset.reunion) setTimeout(() => document.dispatchEvent(new CustomEvent('reunion:ouvrir', { detail: c.dataset.reunion })), 50);
  });
  const now = new Date().toISOString();

  const seance = (async () => {
    const { data: ev } = await sb.from('events').select('id, title, starts_at, location, camps').eq('published', true).is('annule_at', null).gte('starts_at', now).order('starts_at').limit(1).maybeSingle();
    if (!ev) return remplir('tdbSeance', '—', 'Aucune séance programmée');
    const { data: ins } = await sb.from('event_signups').select('camp').eq('event_key', ev.id).eq('reponse', 'oui');
    const n = (ins || []).length; const camps = (ev.camps || []).map((c: string) => `${esc(c)} ${(ins || []).filter((x) => x.camp === c).length}`).join(' · ');
    remplir('tdbSeance', `${n} inscrit${n > 1 ? 's' : ''}`, `<strong>${esc(ev.title)}</strong><br>${esc(jour(ev.starts_at))} (${dans(ev.starts_at)})${ev.location ? ` · ${esc(ev.location)}` : ''}${camps ? `<br>${camps}` : ''}`);
  })();
  const taches = (async () => {
    const { data } = await sb.from('bureau_taches').select('titre, echeance').eq('assigne_a', me.id).neq('statut', 'fait').order('echeance', { ascending: true, nullsFirst: false });
    const ts = data || []; const auj = new Date().toLocaleDateString('fr-CA');
    const retard = ts.filter((t) => t.echeance && t.echeance < auj).length;
    remplir('tdbTaches', String(ts.length), ts.length ? `${retard ? `<span class="tk-late">${retard} en retard</span> · ` : ''}${esc(ts[0].titre)}${ts[0].echeance ? ` (avant le ${new Date(ts[0].echeance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})` : ''}` : 'Rien à faire, bravo', retard > 0);
  })();
  const reunion = (async () => {
    const { data } = await sb.from('bureau_reunions').select('id, titre, quand, lieu').eq('statut', 'prevue').order('quand');
    const rs = data || []; const prochaine = rs.find((r) => r.quand >= now); const aClore = rs.filter((r) => r.quand < now).length;
    const sR = document.getElementById('sReunion'); if (sR) sR.textContent = String(rs.length);
    if (prochaine) { ($('tdbReunion') as HTMLElement).dataset.reunion = prochaine.id; }
    remplir('tdbReunion', prochaine ? dans(prochaine.quand) : '—', prochaine ? `<strong>${esc(prochaine.titre)}</strong><br>${esc(jour(prochaine.quand))}${prochaine.lieu ? ` · ${esc(prochaine.lieu)}` : ''}` : (aClore ? '' : 'Aucune réunion prévue') + (aClore ? `<span class="tk-late">${aClore} réunion${aClore > 1 ? 's' : ''} à clôturer</span>` : ''), aClore > 0);
  })();
  const cand = (async () => {
    const { data, error } = await sb.from('candidatures').select('statut').in('statut', ['nouvelle', 'en_cours']);
    if (error) return remplir('tdbCand', '?', 'Liste indisponible');
    const count = (data || []).length, nouv = (data || []).filter((c) => c.statut === 'nouvelle').length;
    remplir('tdbCand', String(count ?? 0), nouv ? `dont ${nouv} nouvelle${nouv > 1 ? 's' : ''}, jamais ouverte${nouv > 1 ? 's' : ''}` : 'Rien de nouveau', !!nouv);
  })();
  const sond = (async () => {
    const { data } = await sb.rpc('sondages_liste'); const ouverts = ((data as any[]) || []).filter((s) => s.ouvert);
    remplir('tdbSond', String(ouverts.length), ouverts.length ? esc(ouverts[0].question) : 'Aucun sondage en cours');
  })();
  const mail = isAdmin ? (async () => {
    const t = (await sb.auth.getSession()).data.session?.access_token || '';
    const r = await postJSON<any>('/api/boite-mail', { dossier: 'inbox', action: 'liste', page: 0 }, t);
    if (!r.ok) return remplir('tdbMail', '?', 'Boîte inaccessible pour le moment');
    const n = r.data.nonLus || 0; const premier = (r.data.items || []).find((m: any) => !m.lu);
    remplir('tdbMail', String(n), n && premier ? `Dernier : ${esc(premier.de?.nom || premier.de?.email || '')} — ${esc(premier.sujet)}` : 'Tout est lu', n > 0);
    const b = document.getElementById('bmNonLus'); if (b) b.textContent = n ? String(n) : '';
  })() : Promise.resolve();
  await Promise.allSettled([seance, taches, reunion, cand, sond, mail]);
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { api } from './newsletter';

// Rubrique « Téléchargements » (administrateurs) : tous les documents PDF du bureau.
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const jour = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

async function telecharger(sb: SupabaseClient, corps: Record<string, unknown>, btn: HTMLButtonElement) {
  const t0 = btn.textContent; btn.disabled = true; btn.textContent = 'Génération…';
  try {
    const { data } = await sb.auth.getSession();
    const r = await fetch(api('/api/telecharger'), { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('application/pdf')) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || (r.status === 546 || e.code === 'WORKER_LIMIT' ? 'Le serveur a manqué de ressources pour ce document. Réessaie dans un instant.' : `Le PDF n'a pas pu être généré (erreur ${r.status}).`));
    }
    const nom = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'document.pdf';
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) { alert((e as Error).message === 'Load failed' || (e as Error).message === 'Failed to fetch' ? 'Connexion au serveur impossible : vérifie ta connexion internet et réessaie.' : (e as Error).message); }
  btn.disabled = false; btn.textContent = t0;
}

const ligne = (titre: string, sous: string, corps: Record<string, unknown>, lib = 'PDF') =>
  `<div class="tl-l"><div><strong>${esc(titre)}</strong><br><span class="small muted">${sous}</span></div><button type="button" class="btn btn-outline btn-sm tl-b" data-c='${esc(JSON.stringify(corps))}'>${lib}</button></div>`;

export function initTelechargements(sb: SupabaseClient) {
  let charge = false;
  const charger = async () => {
    const [{ data: ev }, { data: el }, { data: sd }, { data: so }] = await Promise.all([
      sb.from('events').select('id, title, type, starts_at, annule_at').order('starts_at', { ascending: false }).limit(60),
      sb.from('elections').select('id, titre, poste, fermeture, publiee, statut').order('created_at', { ascending: false }),
      sb.from('sondages').select('id, question, created_at, fin, clos').order('created_at', { ascending: false }),
      sb.from('sorties').select('id, titre, quand, annule_at').order('quand', { ascending: false }),
    ]);
    $('tlSeances').innerHTML = (ev || []).map((e) => ligne(e.title, `${esc(e.type)} · ${jour(e.starts_at)}${e.annule_at ? ' · annulée' : ''}`, { type: 'seance', id: e.id }, 'Fiche PDF')).join('') || '<p class="small muted">Aucune séance.</p>';
    const pub = (el || []).filter((e) => e.publiee);
    $('tlElections').innerHTML = pub.map((e) => ligne(e.titre, `${e.poste ? esc(e.poste) + ' · ' : ''}clos le ${e.fermeture ? jour(e.fermeture) : '—'}`, { type: 'election', id: e.id }, 'Résultats PDF')).join('')
      || `<p class="small muted">Aucun résultat publié pour l'instant.${(el || []).length ? ' Les élections apparaissent ici une fois leurs résultats publiés.' : ''}</p>`;
    $('tlSondages').innerHTML = (sd || []).map((s) => ligne(s.question, `créé le ${jour(s.created_at)}${s.fin ? ` · fin ${jour(s.fin)}` : ''}`, { type: 'sondage', id: s.id }, 'Résultats PDF')).join('') || '<p class="small muted">Aucun sondage.</p>';
    $('tlSorties').innerHTML = (so || []).map((s) => ligne(s.titre, `${jour(s.quand)}${s.annule_at ? ' · annulée' : ''}`, { type: 'sortie', id: s.id }, 'Liste PDF')).join('') || '<p class="small muted">Aucune sortie.</p>';
    const { data: ar } = await sb.from('archives_pdf').select('id, created_at, fichier, documents, test').order('created_at', { ascending: false });
    $('tlArchives').innerHTML = (ar || []).map((a) => `<div class="tl-l"><div><strong>${esc(new Date(a.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }))}${a.test ? ' (test)' : ''}</strong><br><span class="small muted">${esc(a.fichier)} · ${a.documents} documents</span><div class="tl-mdp hidden" data-id="${a.id}"></div></div><button type="button" class="btn btn-outline btn-sm tl-voir" data-id="${a.id}">Mot de passe</button></div>`).join('') || '<p class="small muted">Aucune archive envoyée pour l\'instant.</p>';
    document.querySelectorAll<HTMLButtonElement>('#tlArchives .tl-voir').forEach((b) => { b.onclick = async () => {
      const box = document.querySelector<HTMLElement>(`.tl-mdp[data-id="${b.dataset.id}"]`)!;
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); box.textContent = ''; b.textContent = 'Mot de passe'; return; }
      const { data, error } = await sb.rpc('archive_mot_de_passe', { p_id: b.dataset.id });
      if (error || !data) { alert('Mot de passe indisponible (expiré ou accès refusé).'); return; }
      box.innerHTML = `<code class="tl-code">${esc(data)}</code> <button type="button" class="btn btn-outline btn-sm tl-copie">Copier</button>`;
      box.classList.remove('hidden'); b.textContent = 'Masquer';
      box.querySelector<HTMLButtonElement>('.tl-copie')!.onclick = async (e) => { await navigator.clipboard.writeText(String(data)).catch(() => {}); (e.target as HTMLButtonElement).textContent = 'Copié'; };
      setTimeout(() => { box.classList.add('hidden'); box.textContent = ''; b.textContent = 'Mot de passe'; }, 60000);
    }; });
    document.querySelectorAll<HTMLButtonElement>('#tab-telechargements .tl-b').forEach((b) => { b.onclick = () => telecharger(sb, JSON.parse(b.dataset.c!), b); });
  };
  document.querySelector('[data-tab="telechargements"]')?.addEventListener('click', () => { if (!charge) { charge = true; charger(); } });
}

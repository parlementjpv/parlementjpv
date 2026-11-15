import type { SupabaseClient } from '@supabase/supabase-js';
import { esc } from './events';

// Onglet État (administrateurs) : effectifs par niveau et par classe, coordonnées, export
type M = { id: string; prenom: string; nom: string; classe: string | null; niveau: string | null; num: number | null; role: string; poste: string | null; banni: boolean; inscrit: string; email: string | null; telephone: string | null; seances: number; absences: number; notifs: boolean; signe: boolean; derniere: string | null };
const NIV = ['Seconde', 'Première', 'Terminale', 'Personnel', 'Autre'];
const $ = (id: string) => document.getElementById(id)!;
const d = (s: string | null) => s ? new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
const groupe = (m: M) => m.niveau ? (['Seconde', 'Première', 'Terminale'].includes(m.niveau) ? `${m.niveau} ${m.num ?? '?'}` : m.niveau === 'Personnel' ? 'Personnel du lycée' : m.niveau) : 'Classe non renseignée';

export async function initEtat(sb: SupabaseClient) {
  const { data, error } = await sb.rpc('etat_membres');
  if (error) { $('etBox').innerHTML = '<p class="muted">Réservé aux administrateurs.</p>'; return; }
  const tous = (data as M[]) || [];
  const actifs = tous.filter((m) => !m.banni);
  const mois = Date.now() - 30 * 86400000;
  const pct = (n: number) => actifs.length ? `${Math.round((100 * n) / actifs.length)} %` : '—';
  $('etKpi').innerHTML = [
    [actifs.length, 'membres actifs'], [tous.filter((m) => new Date(m.inscrit).getTime() > mois).length, 'nouveaux ces 30 jours'],
    [tous.length - actifs.length, 'comptes suspendus'], [pct(actifs.filter((m) => m.notifs).length), 'ont activé les notifications'],
    [pct(actifs.filter((m) => m.signe).length), 'ont signé leur certificat'],
  ].map(([n, l]) => `<div class="et-k"><strong>${n}</strong><span>${l}</span></div>`).join('');

  // Effectifs par niveau puis par classe
  const parNiveau = NIV.map((n) => ({ n, ms: actifs.filter((m) => m.niveau === n) })).filter((x) => x.ms.length);
  const sansClasse = actifs.filter((m) => !m.niveau);
  const tailles = new Map<string, number>(); actifs.forEach((m) => tailles.set(groupe(m), (tailles.get(groupe(m)) || 0) + 1));
  const max = Math.max(1, ...tailles.values());
  const ligne = (nom: string, ms: M[]) => {
    const s = ms.reduce((a, m) => a + m.seances, 0);
    return `<tr class="et-row" data-g="${esc(nom)}" tabindex="0"><td><strong>${esc(nom)}</strong></td><td><span class="et-bar" style="--w:${(100 * ms.length) / max}%"></span> ${ms.length}</td><td>${s}</td><td>${ms.length ? (s / ms.length).toFixed(1).replace('.', ',') : '—'}</td><td>${ms.filter((m) => m.poste || m.role !== 'membre').length || ''}</td></tr>`;
  };
  const sousGroupes = (ms: M[]) => [...new Set(ms.map(groupe))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })).map((g) => ligne(g, ms.filter((m) => groupe(m) === g))).join('');
  $('etTable').innerHTML = `<thead><tr><th>Classe</th><th>Membres</th><th>Présences</th><th>Moyenne</th><th>Bureau</th></tr></thead><tbody>${
    parNiveau.map(({ n, ms }) => `<tr class="et-niv"><th colspan="5">${n === 'Personnel' ? 'Personnel du lycée' : n} · ${ms.length} membre${ms.length > 1 ? 's' : ''}</th></tr>${['Seconde', 'Première', 'Terminale'].includes(n) ? sousGroupes(ms) : ligne(n === 'Personnel' ? 'Personnel du lycée' : n, ms)}`).join('')
  }${sansClasse.length ? ligne('Classe non renseignée', sansClasse) : ''}</tbody>`;

  // Détail d'une classe (ou recherche)
  let sel = '';
  const detail = () => {
    const q = ($('etQ') as HTMLInputElement).value.trim().toLowerCase(), avecSusp = ($('etSusp') as HTMLInputElement).checked;
    const ms = tous.filter((m) => (avecSusp || !m.banni) && (!sel || groupe(m) === sel) && (!q || `${m.prenom} ${m.nom} ${groupe(m)} ${m.email || ''}`.toLowerCase().includes(q)));
    $('etTitre').textContent = sel ? `${sel} (${ms.length})` : `Tous les membres (${ms.length})`;
    $('etDetail').innerHTML = ms.length ? ms.map((m) => `<tr${m.banni ? ' class="banned"' : ''}><td><strong>${esc(m.prenom)} ${esc(m.nom)}</strong>${m.poste ? `<br><span class="poste-badge" style="margin:0">${esc(m.poste)}</span>` : ''}${m.banni ? ' <span class="pill pill-gold">suspendu</span>' : ''}</td>
      <td>${esc(groupe(m))}</td><td class="small">${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}${m.telephone ? `<br><a href="tel:${esc(m.telephone)}">${esc(m.telephone)}</a>` : ''}</td>
      <td>${d(m.inscrit)}</td><td>${m.seances}${m.absences ? ` <span class="small muted">· ${m.absences} abs.</span>` : ''}</td><td>${d(m.derniere)}</td><td class="small">${m.notifs ? 'Notifs ✓' : ''}${m.signe ? `${m.notifs ? '<br>' : ''}Signé ✓` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">Personne.</td></tr>';
    $('etTout').classList.toggle('hidden', !sel);
  };
  const choisir = (g: string) => { sel = g; detail(); $('etDetailBox').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('etTable').addEventListener('click', (e) => { const r = (e.target as HTMLElement).closest('.et-row') as HTMLElement | null; if (r) choisir(r.dataset.g!); });
  $('etTable').addEventListener('keydown', (e) => { const r = (e.target as HTMLElement).closest('.et-row') as HTMLElement | null; if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choisir(r.dataset.g!); } });
  $('etTout').addEventListener('click', () => { sel = ''; detail(); });
  ['etQ', 'etSusp'].forEach((id) => $(id).addEventListener('input', detail));
  $('etExport').addEventListener('click', () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const ms = tous.filter((m) => !sel || groupe(m) === sel);
    const csv = 'prenom;nom;niveau;numero;classe;email;telephone;role;poste;suspendu;inscrit_le;seances;absences;derniere_seance;notifications;certificat_signe\n'
      + ms.map((m) => [m.prenom, m.nom, m.niveau, m.num, groupe(m), m.email, m.telephone, m.role, m.poste, m.banni ? 'oui' : 'non', m.inscrit.slice(0, 10), m.seances, m.absences, m.derniere?.slice(0, 10), m.notifs ? 'oui' : 'non', m.signe ? 'oui' : 'non'].map(q).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `etat-membres${sel ? '-' + sel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-') : ''}.csv`; a.click();
  });
  detail();
}

import { esc } from './events';

// Tournoi d'éloquence : affichage du tableau (élimination directe)
export type Match = { id: string; tour: number; position: number; a: string | null; b: string | null; a_nom: string | null; b_nom: string | null; sujet: string | null; quand: string | null; lieu: string | null; gagnant: string | null };
export type Tournoi = { id: string; nom: string; description: string; statut: 'inscriptions' | 'en_cours' | 'termine'; fin_inscriptions: string | null; max: number | null; created_at: string; champion: string | null; inscrits: number; moi_inscrit: boolean; participants: { id: string; nom: string }[] | null; matchs: Match[] };

export function nomTour(tour: number, nbTours: number) {
  const restants = 2 ** (nbTours - tour + 1);
  return ({ 2: 'Finale', 4: 'Demi-finales', 8: 'Quarts de finale', 16: 'Huitièmes de finale', 32: 'Seizièmes de finale', 64: 'Trente-deuxièmes' } as Record<number, string>)[restants] || `Tour ${tour}`;
}

export const fmtQuand = (d: string | null) => d ? new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(':', 'h') : '';

/** Tableau en colonnes, un tour par colonne. `extra(m)` ajoute du contenu (outils du bureau). */
export function tableauHtml(t: Tournoi, opts: { moi?: string; extra?: (m: Match, nbTours: number) => string } = {}) {
  if (!t.matchs.length) return '';
  const nbTours = Math.max(...t.matchs.map((m) => m.tour));
  const cols = Array.from({ length: nbTours }, (_, i) => i + 1).map((r) => {
    const ms = t.matchs.filter((m) => m.tour === r);
    return `<div class="tb-col"><h3 class="tb-tour">${esc(nomTour(r, nbTours))}</h3><div class="tb-matchs">${ms.map((m) => {
      const exempt = r === 1 && m.a && !m.b;
      const ligne = (id: string | null, nom: string | null) => `<div class="tb-j${m.gagnant && id === m.gagnant ? ' gagne' : ''}${m.gagnant && id && id !== m.gagnant ? ' perdu' : ''}${opts.moi && id === opts.moi ? ' moi' : ''}">${nom ? esc(nom) : exempt ? '<span class="muted">qualifié d\'office</span>' : '<span class="muted">à déterminer</span>'}</div>`;
      return `<div class="tb-m${exempt ? ' exempt' : ''}" data-id="${m.id}">${ligne(m.a, m.a_nom)}${exempt ? '' : ligne(m.b, m.b_nom)}
        ${m.sujet || m.quand ? `<div class="tb-info small">${m.sujet ? `<span>« ${esc(m.sujet)} »</span>` : ''}${m.quand ? `<span class="muted">${esc(fmtQuand(m.quand))}${m.lieu ? ` · ${esc(m.lieu)}` : ''}</span>` : ''}</div>` : ''}
        ${opts.extra ? opts.extra(m, nbTours) : ''}</div>`;
    }).join('')}</div></div>`;
  }).join('');
  return `<div class="tb" style="--tours:${nbTours}">${cols}</div>`;
}

/** Prochain duel d'un membre dans un tournoi en cours */
export function monDuel(t: Tournoi, moi: string) {
  return t.matchs.filter((m) => !m.gagnant && (m.a === moi || m.b === moi) && m.a && m.b).sort((x, y) => x.tour - y.tour)[0] || null;
}
export function elimine(t: Tournoi, moi: string) {
  return t.matchs.some((m) => m.gagnant && m.a && m.b && (m.a === moi || m.b === moi) && m.gagnant !== moi);
}

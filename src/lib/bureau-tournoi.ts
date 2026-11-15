import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { esc } from './events';
import { postJSON } from './newsletter';
import { tableauHtml, nomTour, type Tournoi, type Match } from './tournoi';

// Espace bureau : organiser un tournoi d'éloquence
const $ = (id: string) => document.getElementById(id)!;
const ERR: Record<string, string> = { pas_assez: 'Il faut au moins 2 inscrits pour lancer le tirage.', deja_tire: 'Le tirage a déjà été fait.', suivant_deja_joue: 'Le duel suivant a déjà un résultat : corrige-le d\'abord.', duel_incomplet: 'Les deux orateurs ne sont pas encore connus.' };
const msgErr = (m: string) => ERR[Object.keys(ERR).find((k) => m.includes(k)) || ''] || m;
const local = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

export async function initTournoi(sb: SupabaseClient, session: Session) {
  const form = $('tnForm') as HTMLFormElement, msg = $('tnMsg'), list = $('tnList');
  const show = (t: string, k = 'err') => (msg.innerHTML = `<div class="alert alert-${k}">${t}</div>`);
  const notif = (body: object) => postJSON<{ envoyes?: number; push?: number }>('/api/tournoi-notif', body, session.access_token);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const fin = String(fd.get('fin') || '');
    const { data, error } = await sb.from('tournois').insert({
      nom: String(fd.get('nom')).trim(), description: String(fd.get('description') || '').trim(),
      fin_inscriptions: fin ? new Date(fin).toISOString() : null, max_participants: Number(fd.get('max')) || null, created_by: session.user.id,
    }).select('id').single();
    if (error) { show("Le tournoi n'a pas pu être créé : vérifie le nom (3 caractères minimum)."); return; }
    form.reset();
    const r = await notif({ action: 'ouverture', tournoi: data.id });
    show(`Tournoi créé : les inscriptions sont ouvertes sur la page Tournoi et dans Mon espace.${r.ok && r.data.push ? ` ${r.data.push} membre${r.data.push > 1 ? 's ont' : ' a'} reçu une notification.` : ''}`, 'ok');
    charger();
  });

  async function charger() {
    const { data } = await sb.rpc('tournois_liste');
    const ts = (data as Tournoi[]) || [];
    $('sTournoi').textContent = String(ts.filter((t) => t.statut !== 'termine').length);
    list.innerHTML = ts.length ? ts.map((t) => {
      const outils = (m: Match, nb: number) => {
        if (t.statut === 'termine' && m.gagnant) return '';
        if (m.tour === 1 && m.a && !m.b) return '';
        const pret = m.a && m.b;
        return `<div class="tb-outils"><details${!m.sujet && pret ? ' open' : ''}><summary class="small">${m.sujet || m.quand ? 'Modifier le duel' : 'Fixer sujet, date et lieu'}</summary>
          <form class="form tn-duel" data-id="${m.id}"><input name="sujet" maxlength="300" placeholder="Sujet du duel" value="${esc(m.sujet || '')}" />
          <div class="form-row"><input name="quand" type="datetime-local" value="${local(m.quand)}" aria-label="Date et heure" /><input name="lieu" maxlength="120" placeholder="Salle" value="${esc(m.lieu || '')}" /></div>
          <button class="btn btn-outline btn-sm" type="submit">Enregistrer${pret ? ' et prévenir les deux orateurs' : ''}</button></form></details>
          ${pret ? `<div class="tb-gagne"><span class="small muted">${m.gagnant ? 'Corriger le vainqueur :' : `Vainqueur ${nomTour(m.tour, nb) === 'Finale' ? 'de la finale' : 'du duel'} :`}</span>
            <button class="btn btn-sm ${m.gagnant === m.a ? 'btn-primary' : 'btn-outline'} tn-win" data-m="${m.id}" data-g="${m.a}" type="button">${esc(m.a_nom || '')}</button>
            <button class="btn btn-sm ${m.gagnant === m.b ? 'btn-primary' : 'btn-outline'} tn-win" data-m="${m.id}" data-g="${m.b}" type="button">${esc(m.b_nom || '')}</button></div>` : ''}</div>`;
      };
      const ouvert = t.statut === 'inscriptions';
      return `<div class="card tn-card" data-id="${t.id}">
        <div class="flex between" style="gap:12px;flex-wrap:wrap;"><div><h3 style="margin:0;">${esc(t.nom)}</h3><span class="small muted">${ouvert ? `${t.inscrits} inscrit${t.inscrits > 1 ? 's' : ''}${t.max ? ` / ${t.max}` : ''}${t.fin_inscriptions ? ` · jusqu'au ${new Date(t.fin_inscriptions).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}` : t.statut === 'en_cours' ? 'En cours' : `Terminé · champion·ne : ${esc(t.champion || '?')}`}</span></div>
          <div class="flex" style="gap:6px;flex-wrap:wrap;">${ouvert ? `<button class="btn btn-primary btn-sm tn-tirage" data-id="${t.id}" type="button">Clore les inscriptions et tirer au sort</button>` : ''}<button class="btn btn-outline btn-sm tn-del" data-id="${t.id}" type="button">Supprimer</button></div></div>
        ${ouvert && t.participants?.length ? `<div class="tn-parts mt-1">${t.participants.map((p) => `<span class="pill">${esc(p.nom)}</span>`).join(' ')}</div>` : ''}
        ${t.matchs.length ? `<div class="mt-2">${tableauHtml(t, { extra: outils })}</div>` : ''}</div>`;
    }).join('') : '<p class="muted">Aucun tournoi. Crée le premier ci-dessus.</p>';

    list.querySelectorAll<HTMLButtonElement>('.tn-tirage').forEach((b) => b.addEventListener('click', async () => {
      const t = ts.find((x) => x.id === b.dataset.id)!;
      if (!confirm(`Clore les inscriptions de « ${t.nom} » (${t.inscrits} inscrits) et tirer au sort le tableau ?\n\nChaque participant recevra son premier duel par email et notification. Le tirage est définitif.`)) return;
      b.disabled = true;
      const { error } = await sb.rpc('tournoi_tirage', { p_tournoi: t.id });
      if (error) { show(msgErr(error.message)); b.disabled = false; return; }
      const r = await notif({ action: 'tirage', tournoi: t.id });
      show(`Tirage effectué. ${r.ok ? `${r.data.envoyes} email${(r.data.envoyes || 0) > 1 ? 's' : ''} envoyé${(r.data.envoyes || 0) > 1 ? 's' : ''} aux participants.` : 'Les emails n\'ont pas pu partir.'} Fixe maintenant le sujet, la date et le lieu de chaque duel.`, 'ok');
      charger();
    }));
    list.querySelectorAll<HTMLButtonElement>('.tn-del').forEach((b) => b.addEventListener('click', async () => {
      const t = ts.find((x) => x.id === b.dataset.id)!;
      if (!confirm(`Supprimer définitivement le tournoi « ${t.nom} », ses inscriptions et tous ses duels ?`)) return;
      const { error } = await sb.from('tournois').delete().eq('id', t.id);
      if (error) show('Suppression impossible.'); else charger();
    }));
    list.querySelectorAll<HTMLFormElement>('.tn-duel').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f), q = String(fd.get('quand') || '');
      const { error } = await sb.from('tournoi_matchs').update({ sujet: String(fd.get('sujet') || '').trim() || null, quand: q ? new Date(q).toISOString() : null, lieu: String(fd.get('lieu') || '').trim() || null }).eq('id', f.dataset.id);
      if (error) { show('Le duel n\'a pas pu être enregistré.'); return; }
      const m = ts.flatMap((t) => t.matchs).find((x) => x.id === f.dataset.id);
      if (m?.a && m?.b) { const r = await notif({ action: 'match', match: m.id }); show(r.ok ? 'Duel enregistré : les deux orateurs sont prévenus par email et notification.' : 'Duel enregistré, mais les emails n\'ont pas pu partir.', r.ok ? 'ok' : 'err'); }
      else show('Duel enregistré.', 'ok');
      charger();
    }));
    list.querySelectorAll<HTMLButtonElement>('.tn-win').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`${b.textContent} remporte ce duel ?`)) return;
      const { error } = await sb.rpc('tournoi_resultat', { p_match: b.dataset.m, p_gagnant: b.dataset.g });
      if (error) { show(msgErr(error.message)); return; }
      const t = ts.find((x) => x.matchs.some((m) => m.id === b.dataset.m))!;
      const nb = Math.max(...t.matchs.map((m) => m.tour));
      const m = t.matchs.find((x) => x.id === b.dataset.m)!;
      if (m.tour === nb) { const r = await notif({ action: 'champion', tournoi: t.id }); show(`${b.textContent} remporte le tournoi ! ${r.ok ? 'Tous les membres sont prévenus.' : ''}`, 'ok'); }
      else show(`${b.textContent} passe au tour suivant.`, 'ok');
      charger();
    }));
  }
  charger();
}

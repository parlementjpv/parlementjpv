import type { SupabaseClient } from '@supabase/supabase-js';
import { postJSON } from './newsletter';

// Réunions du bureau : ordre du jour partagé, notes, décisions (versées au registre) et tâches attribuées.
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const quand = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function initReunions(sb: SupabaseClient, me: { id: string }, isAdmin: boolean) {
  let charge = false, courante: any = null, membres: any[] = [];
  const tok = async () => (await sb.auth.getSession()).data.session?.access_token || '';
  const nomDe = (id: string | null) => { const m = membres.find((x) => x.id === id); return m ? `${m.prenom} ${(m.nom || '').slice(0, 1)}.` : 'Personne'; };

  async function liste() {
    const { data } = await sb.from('bureau_reunions').select('id, titre, quand, lieu, statut').order('quand', { ascending: false });
    const rs = data || [], now = Date.now();
    const aVenir = rs.filter((r) => r.statut === 'prevue').sort((a, b) => +new Date(a.quand) - +new Date(b.quand));
    const passees = rs.filter((r) => r.statut !== 'prevue');
    const ligne = (r: any) => `<button type="button" class="ru-l${courante?.id === r.id ? ' actif' : ''}" data-id="${r.id}"><strong>${esc(r.titre)}</strong><span class="small muted">${esc(quand(r.quand))}${r.lieu ? ` · ${esc(r.lieu)}` : ''}${r.statut === 'prevue' && +new Date(r.quand) < now ? ' · <span class="tk-late">à clôturer</span>' : ''}</span></button>`;
    $('ruListe').innerHTML = (aVenir.length ? `<h4>À venir</h4>${aVenir.map(ligne).join('')}` : '<p class="small muted">Aucune réunion prévue.</p>') + (passees.length ? `<h4 class="mt-2">Clôturées</h4>${passees.map(ligne).join('')}` : '');
  }

  async function ouvrir(id: string) {
    const [{ data: r }, { data: dec }, { data: tks }] = await Promise.all([
      sb.from('bureau_reunions').select('*').eq('id', id).single(),
      sb.from('bureau_decisions').select('*').eq('reunion_id', id).order('created_at'),
      sb.from('bureau_taches').select('*').eq('reunion_id', id).order('created_at'),
    ]);
    courante = r; if (!r) return;
    const fini = r.statut === 'terminee';
    $('ruDetail').innerHTML = `
      <div class="flex between" style="gap:10px;flex-wrap:wrap;"><div><h3 style="margin:0;">${esc(r.titre)}</h3><p class="small muted" style="margin:4px 0 0;">${esc(quand(r.quand))}${r.lieu ? ` · ${esc(r.lieu)}` : ''} · ${fini ? 'Clôturée' : 'Prévue'}${r.convoque_at ? ' · bureau convoqué' : ''}</p></div>
        <div class="flex" style="gap:6px;flex-wrap:wrap;">${fini ? '<button class="btn btn-outline btn-sm" id="ruRouvrir" type="button">Rouvrir</button>' : `<button class="btn btn-outline btn-sm" id="ruConv" type="button">${r.convoque_at ? 'Reconvoquer' : 'Convoquer le bureau'}</button><button class="btn btn-sm" id="ruClore" type="button">Clôturer la réunion</button>`}
        <button class="btn btn-outline btn-sm" id="ruPdf" type="button">Compte rendu PDF par email</button><button class="lnk" id="ruSuppr" type="button">Supprimer</button></div></div>
      <div class="field mt-2"><label for="ruOdj">Ordre du jour <span class="muted small">(partagé : chacun peut ajouter un point)</span></label><textarea id="ruOdj" maxlength="10000" style="min-height:110px;" placeholder="1. Bilan de la dernière séance&#10;2. Choix de la prochaine motion&#10;3. Sortie de décembre">${esc(r.ordre_du_jour)}</textarea></div>
      <div class="field"><label for="ruNotes">Notes de réunion</label><textarea id="ruNotes" maxlength="50000" style="min-height:160px;" placeholder="Ce qui s'est dit, point par point…">${esc(r.notes)}</textarea></div>
      <div class="flex" style="gap:8px;align-items:center;"><button class="btn btn-primary btn-sm" id="ruSave" type="button">Enregistrer</button><span class="small muted" id="ruInfo"></span></div>
      <h4 class="mt-3">Décisions <span class="muted small">— chacune est inscrite au registre du bureau</span></h4>
      <ol class="ru-dec">${(dec || []).map((x) => `<li>${esc(x.texte)} <span class="small muted">· ${new Date(x.created_at).toLocaleDateString('fr-FR')}</span></li>`).join('') || '<li class="muted small" style="list-style:none;margin-left:-20px;">Aucune décision pour l\'instant.</li>'}</ol>
      <form class="flex" id="ruDecForm" style="gap:6px;"><input id="ruDecIn" maxlength="1000" required placeholder="Ex. La séance du 12 décembre portera sur la motion « Interdire les portables au lycée »" style="flex:1;" /><button class="btn btn-outline btn-sm" type="submit">Ajouter la décision</button></form>
      <h4 class="mt-3">Tâches décidées</h4>
      <div class="ru-tks">${(tks || []).map((t) => `<div class="ru-tk${t.statut === 'fait' ? ' fait' : ''}"><strong>${esc(t.titre)}</strong> <span class="small muted">${esc(nomDe(t.assigne_a))}${t.echeance ? ` · avant le ${new Date(t.echeance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : ''} · ${t.statut === 'fait' ? 'fait' : t.statut === 'en_cours' ? 'en cours' : 'à faire'}</span></div>`).join('') || '<p class="small muted">Aucune tâche.</p>'}</div>
      <form class="form-row" id="ruTkForm" style="align-items:end;gap:6px;"><div class="field" style="flex:2;"><input name="titre" maxlength="200" required placeholder="Ex. Réserver la salle Samuel Paty" /></div>
        <div class="field"><select name="assigne"><option value="">Personne</option>${membres.map((m) => `<option value="${m.id}">${esc(m.prenom)} ${esc(m.nom)}</option>`).join('')}</select></div>
        <div class="field"><input name="echeance" type="date" /></div><button class="btn btn-outline btn-sm" type="submit">Attribuer</button></form>
      <p class="small muted">La personne reçoit un email tout de suite, un rappel la veille de l'échéance, puis une relance si la tâche est en retard. Ces tâches apparaissent aussi dans « Entre nous ».</p>`;
    liste();
  }

  async function enregistrer(silencieux = false) {
    if (!courante) return;
    const { error } = await sb.from('bureau_reunions').update({ ordre_du_jour: ($('ruOdj') as HTMLTextAreaElement).value, notes: ($('ruNotes') as HTMLTextAreaElement).value }).eq('id', courante.id);
    if (!silencieux) $('ruInfo').textContent = error ? `Erreur : ${error.message}` : `Enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    return !error;
  }

  $('ruDetail').addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || !courante) return;
    if (b.id === 'ruSave') enregistrer();
    if (b.id === 'ruConv') {
      if (!confirm("Envoyer la convocation et l'ordre du jour par email à tout le bureau ?")) return;
      await enregistrer(true); b.disabled = true; b.textContent = 'Envoi…';
      const r = await postJSON<any>('/api/bureau-rappels', { action: 'convoquer', id: courante.id }, await tok());
      alert(r.ok ? `Convocation envoyée (${r.data.emails} emails).` : r.error || 'Envoi impossible.'); ouvrir(courante.id);
    }
    if (b.id === 'ruClore') { if (!confirm('Clôturer la réunion ? Les notes restent modifiables si tu la rouvres.')) return; await enregistrer(true); await sb.from('bureau_reunions').update({ statut: 'terminee', cloturee_at: new Date().toISOString() }).eq('id', courante.id); ouvrir(courante.id); }
    if (b.id === 'ruRouvrir') { await sb.from('bureau_reunions').update({ statut: 'prevue' }).eq('id', courante.id); ouvrir(courante.id); }
    if (b.id === 'ruSuppr') { if (!confirm('Supprimer cette réunion, ses notes et ses décisions ? (Les tâches restent dans « Entre nous », le registre garde les décisions.)')) return; await sb.from('bureau_reunions').delete().eq('id', courante.id); courante = null; $('ruDetail').innerHTML = '<p class="muted">Choisis une réunion.</p>'; liste(); }
    if (b.id === 'ruPdf') { await enregistrer(true); const { envoyerParEmail } = await import('./telechargements'); await envoyerParEmail(await tok(), [{ type: 'reunion', id: courante.id }], `Réunion du bureau — ${courante.titre}`, b); }
  });
  $('ruDetail').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target as HTMLFormElement; if (!courante) return;
    if (f.id === 'ruDecForm') {
      const t = ($('ruDecIn') as HTMLInputElement).value.trim(); if (t.length < 2) return;
      await enregistrer(true);
      const { error } = await sb.from('bureau_decisions').insert({ reunion_id: courante.id, texte: t });
      if (error) alert(error.message); else ouvrir(courante.id);
    }
    if (f.id === 'ruTkForm') {
      const fd = new FormData(f); await enregistrer(true);
      const { data, error } = await sb.from('bureau_taches').insert({ titre: String(fd.get('titre')).trim(), assigne_a: String(fd.get('assigne') || '') || null, echeance: String(fd.get('echeance') || '') || null, reunion_id: courante.id, created_by: me.id }).select('id').single();
      if (error) { alert(error.message); return; }
      postJSON('/api/bureau-rappels', { action: 'tache', id: data.id }, await tok());
      document.dispatchEvent(new CustomEvent('taches:maj'));
      ouvrir(courante.id);
    }
  });
  $('ruListe').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('.ru-l') as HTMLButtonElement | null; if (b) ouvrir(b.dataset.id!); });

  ($('ruForm') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target as HTMLFormElement; const fd = new FormData(f);
    const { data, error } = await sb.from('bureau_reunions').insert({ titre: String(fd.get('titre')).trim(), quand: new Date(String(fd.get('quand'))).toISOString(), lieu: String(fd.get('lieu') || '').trim() || null, ordre_du_jour: String(fd.get('odj') || '') }).select('id').single();
    if (error) { alert(error.message); return; }
    f.reset(); ouvrir(data.id);
  });

  const charger = async () => {
    const { data } = await sb.rpc('bureau_membres'); membres = (data as any[]) || [];
    await liste();
    const id = new URLSearchParams(location.hash.slice(1)).get('reunion');
    if (id) ouvrir(id);
  };
  document.addEventListener('reunion:ouvrir', (e) => { const id = (e as CustomEvent).detail; if (!charge) { charge = true; charger().then(() => ouvrir(id)); } else ouvrir(id); });
  document.querySelector('[data-tab="reunions"]')?.addEventListener('click', () => { if (!charge) { charge = true; charger(); } });
  return { ouvrir: (id: string) => { if (!charge) { charge = true; charger().then(() => ouvrir(id)); } else ouvrir(id); } };
}

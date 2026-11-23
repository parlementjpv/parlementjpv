import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { esc } from './events';
import { postJSON } from './newsletter';

// Espace bureau : sondages, sorties et visites, boîte à idées anonyme
const $ = (id: string) => document.getElementById(id)!;
const iso = (v: FormDataEntryValue | null) => (v ? new Date(String(v)).toISOString() : null);
const fdate = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
const alerte = (el: HTMLElement, t: string, k = 'ok') => (el.innerHTML = `<div class="alert alert-${k}">${t}</div>`);

export function initVie(sb: SupabaseClient, session: Session) {
  const notif = (body: object) => postJSON<{ push?: number; envoyes?: number; emails?: number }>('/api/vie-notif', body, session.access_token);

  /* ── Sondages ── */
  const sdForm = $('sdForm') as HTMLFormElement;
  $('sdAddOpt').addEventListener('click', () => {
    const n = $('sdOpts').querySelectorAll('input').length; if (n >= 8) return;
    $('sdOpts').insertAdjacentHTML('beforeend', `<input name="opt" maxlength="100" placeholder="Choix ${n + 1}" />`);
  });
  sdForm.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(sdForm);
    const options = fd.getAll('opt').map((o) => String(o).trim()).filter(Boolean);
    if (options.length < 2) { alerte($('sdMsg'), 'Il faut au moins 2 choix.', 'err'); return; }
    const { data, error } = await sb.from('sondages').insert({ question: String(fd.get('question')).trim(), options, multiple: fd.get('multiple') === 'on', fin: iso(fd.get('fin')), created_by: session.user.id }).select('id').single();
    if (error) { alerte($('sdMsg'), 'Le sondage n\'a pas pu être créé.', 'err'); return; }
    const r = await notif({ action: 'sondage', id: data.id });
    const d: any = r.ok ? r.data : {};
    alerte($('sdMsg'), `Sondage publié : ${d.emails || 0} email${(d.emails || 0) > 1 ? 's' : ''} envoyé${(d.emails || 0) > 1 ? 's' : ''} aux membres${d.push ? ` et ${d.push} notification${d.push > 1 ? 's' : ''}` : ''}.`);
    sdForm.reset(); $('sdOpts').innerHTML = '<input name="opt" maxlength="100" placeholder="Choix 1" required /><input name="opt" maxlength="100" placeholder="Choix 2" required />';
    chargerSondages();
  });
  async function chargerSondages() {
    const { data } = await sb.rpc('sondages_liste'); const ss = (data as any[]) || [];
    $('sSondages').textContent = String(ss.filter((s) => s.ouvert).length);
    $('sdList').innerHTML = ss.length ? ss.map((s) => `<div class="card vie-item"><div class="flex between" style="gap:10px;flex-wrap:wrap;"><strong>${esc(s.question)}</strong><span class="small muted">${s.ouvert ? 'Ouvert' : 'Clos'} · ${s.votants} réponse${s.votants > 1 ? 's' : ''}</span></div>
      <div class="vie-res">${s.options.map((o: string, i: number) => { const p = s.votants ? Math.round((100 * (s.compte[i] || 0)) / s.votants) : 0; return `<div class="vie-bar"><span style="--p:${p}%"></span><em>${esc(o)}</em><b>${s.compte[i] || 0} · ${p} %</b></div>`; }).join('')}</div>
      <div class="flex" style="gap:6px;">${s.ouvert ? `<button class="btn btn-outline btn-sm sd-clore" data-id="${s.id}" type="button">Clore</button>` : ''}<button class="btn btn-outline btn-sm sd-del" data-id="${s.id}" type="button">Supprimer</button></div></div>`).join('') : '<p class="muted">Aucun sondage.</p>';
    $('sdList').querySelectorAll<HTMLButtonElement>('.sd-clore').forEach((b) => b.addEventListener('click', async () => { await sb.from('sondages').update({ clos: true }).eq('id', b.dataset.id); chargerSondages(); }));
    $('sdList').querySelectorAll<HTMLButtonElement>('.sd-del').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Supprimer ce sondage et ses réponses ?')) return; await sb.from('sondages').delete().eq('id', b.dataset.id); chargerSondages(); }));
  }

  /* ── Sorties ── */
  const soForm = $('soForm') as HTMLFormElement;
  soForm.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(soForm);
    const { data, error } = await sb.from('sorties').insert({
      titre: String(fd.get('titre')).trim(), description: String(fd.get('description') || '').trim(), lieu: String(fd.get('lieu') || '').trim(),
      rdv: String(fd.get('rdv') || '').trim(), retour: String(fd.get('retour') || '').trim(), quand: iso(fd.get('quand')), limite: iso(fd.get('limite')),
      places: Number(fd.get('places')) || null, autorisation: fd.get('autorisation') === 'on', created_by: session.user.id,
    }).select('id').single();
    if (error) { alerte($('soMsg'), 'La sortie n\'a pas pu être créée : vérifie le titre et la date.', 'err'); return; }
    const r = await notif({ action: 'sortie', id: data.id });
    alerte($('soMsg'), `Sortie publiée${r.ok && r.data.push ? ` : ${r.data.push} membre${r.data.push > 1 ? 's ont' : ' a'} reçu une notification` : ''}.`);
    soForm.reset(); (soForm.elements.namedItem('autorisation') as HTMLInputElement).checked = true; chargerSorties();
  });
  async function chargerSorties() {
    const { data } = await sb.rpc('sorties_liste'); const ss = (data as any[]) || [];
    $('sSorties').textContent = String(ss.filter((s) => !s.annule && new Date(s.quand) > new Date()).length);
    $('soList').innerHTML = ss.length ? ss.map((s) => `<div class="card vie-item${s.annule ? ' annulee' : ''}">
      <div class="flex between" style="gap:10px;flex-wrap:wrap;"><div><strong>${esc(s.titre)}</strong><br><span class="small muted">${esc(fdate(s.quand))}${s.lieu ? ` · ${esc(s.lieu)}` : ''} · ${s.inscrits}${s.places ? `/${s.places}` : ''} inscrit${s.inscrits > 1 ? 's' : ''}${s.attente ? ` · ${s.attente} en attente` : ''}${s.annule ? ' · ANNULÉE' : ''}</span></div>
        <div class="flex" style="gap:6px;">${!s.annule && new Date(s.quand) > new Date() ? `<button class="btn btn-outline btn-sm so-annul" data-id="${s.id}" type="button">Annuler la sortie</button>` : ''}<button class="btn btn-outline btn-sm so-del" data-id="${s.id}" type="button">Supprimer</button></div></div>
      ${s.liste?.length ? `<table class="table mt-1 small"><thead><tr><th>Élève</th><th>Classe</th><th>Statut</th>${s.autorisation ? '<th>Autorisation reçue</th>' : ''}</tr></thead><tbody>${s.liste.map((p: any) => `<tr><td>${esc(p.nom)}</td><td>${esc(p.classe || '')}</td><td>${p.statut === 'inscrit' ? 'Inscrit·e' : 'Liste d\'attente'}</td>${s.autorisation ? `<td>${p.statut === 'inscrit' ? `<label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" class="so-aut" data-s="${s.id}" data-u="${p.id}" ${p.autorisation ? 'checked' : ''} /> ${p.autorisation ? 'oui' : 'non'}</label>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="small muted">Personne d\'inscrit pour l\'instant.</p>'}</div>`).join('') : '<p class="muted">Aucune sortie.</p>';
    $('soList').querySelectorAll<HTMLInputElement>('.so-aut').forEach((c) => c.addEventListener('change', async () => {
      const { error } = await sb.from('sortie_inscrits').update({ autorisation_recue: c.checked }).eq('sortie', c.dataset.s).eq('user_id', c.dataset.u);
      if (error) { c.checked = !c.checked; alert('Modification impossible.'); } else (c.nextSibling as Text).textContent = c.checked ? ' oui' : ' non';
    }));
    $('soList').querySelectorAll<HTMLButtonElement>('.so-annul').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Annuler cette sortie ? Tous les inscrits seront prévenus par email et notification.')) return;
      await sb.from('sorties').update({ annule_at: new Date().toISOString() }).eq('id', b.dataset.id);
      const r = await notif({ action: 'sortie-annulee', id: b.dataset.id }); alerte($('soMsg'), `Sortie annulée${r.ok ? ` : ${r.data.envoyes} inscrit${(r.data.envoyes || 0) > 1 ? 's prévenus' : ' prévenu'}` : ''}.`); chargerSorties();
    }));
    $('soList').querySelectorAll<HTMLButtonElement>('.so-del').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Supprimer définitivement cette sortie et ses inscriptions ?')) return; await sb.from('sorties').delete().eq('id', b.dataset.id); chargerSorties(); }));
  }

  /* ── Boîte à idées ── */
  async function chargerIdees() {
    const { data } = await sb.from('idees').select('*').neq('statut', 'archivee').order('created_at', { ascending: false });
    const ids = data || [];
    $('sIdees').textContent = String(ids.filter((i) => i.statut === 'nouvelle').length);
    $('idList').innerHTML = ids.length ? ids.map((i) => `<div class="card vie-item" data-id="${i.id}">
      <div class="flex between" style="gap:10px;flex-wrap:wrap;"><span class="pill">${esc(i.categorie)}</span><span class="small muted">${new Date(i.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · ${i.statut === 'nouvelle' ? '<strong>nouveau</strong>' : i.statut === 'retenue' ? 'retenu' : 'lu'}</span></div>
      <p style="white-space:pre-wrap;margin:6px 0;">${esc(i.texte)}</p>
      <textarea class="id-rep" maxlength="1000" placeholder="Réponse publique (facultatif) : visible par tous les membres, à côté du message anonyme" style="min-height:60px;">${esc(i.reponse || '')}</textarea>
      <div class="flex" style="gap:6px;flex-wrap:wrap;"><button class="btn btn-outline btn-sm id-save" data-st="lue" type="button">Marquer comme lu</button><button class="btn btn-outline btn-sm id-save" data-st="retenue" type="button">Retenir l'idée</button><button class="btn btn-outline btn-sm id-save" data-st="archivee" type="button">Archiver</button></div></div>`).join('') : '<p class="muted">La boîte est vide.</p>';
    $('idList').querySelectorAll<HTMLButtonElement>('.id-save').forEach((b) => b.addEventListener('click', async () => {
      const c = b.closest('.vie-item') as HTMLElement; const rep = (c.querySelector('.id-rep') as HTMLTextAreaElement).value.trim();
      await sb.from('idees').update({ statut: b.dataset.st, reponse: rep || null }).eq('id', c.dataset.id); chargerIdees();
    }));
  }
  chargerSondages(); chargerSorties(); chargerIdees();
}

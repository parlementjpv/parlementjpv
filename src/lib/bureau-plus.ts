// Onglets du tableau de bord du bureau : appel, élections, motions, espace interne (« Entre nous »).
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { postJSON } from './newsletter';
import postes from '../data/postes.json';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const $ = (id: string) => document.getElementById(id)!;
const fmtDate = (s: string) => new Date(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const fmtDT = (s: string) => new Date(s).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' });
const ago = (d: string) => { const s = (Date.now() - new Date(d).getTime()) / 1000; return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : fmtDT(d); };
const ERR: Record<string, string> = {
  aucun_candidat: "Ajoute au moins un candidat avant d'ouvrir le vote.", fermeture_invalide: 'Indique une date de clôture dans le futur.',
  deja_ouverte: 'Ce vote est déjà ouvert.', pas_ouverte: "Ce vote n'est pas ouvert.", pas_close: "Le vote n'est pas encore clos.",
};
const errFr = (m: string) => Object.entries(ERR).find(([k]) => m.includes(k))?.[1] || m;

export async function initBureauPlus(sb: SupabaseClient, session: Session, me: { id: string; prenom: string; nom: string; role: string }) {
  initAppel(sb, session);
  initElections(sb);
  initMotions(sb);
  initEntreNous(sb, me);
}

/* ────────────────────────── Appel ────────────────────────── */
async function initAppel(sb: SupabaseClient, session: Session) {
  const sel = $('apEvent') as HTMLSelectElement, list = $('apList'), msg = $('apMsg');
  const { data: evs } = await sb.from('events').select('id, title, type, starts_at, camps').is('annule_at', null)
    .lte('starts_at', new Date(Date.now() + 6 * 3600 * 1000).toISOString()).order('starts_at', { ascending: false }).limit(40);
  const { data: seuilRow } = await sb.from('reglages').select('valeur').eq('cle', 'seuil_absences').maybeSingle();
  $('apSeuil').textContent = seuilRow?.valeur || '3';
  if (!evs?.length) { sel.innerHTML = '<option value="">Aucune séance passée ou du jour</option>'; list.innerHTML = '<p class="muted">L\'appel sera possible le jour de la première séance.</p>'; return; }
  sel.innerHTML = evs.map((e) => `<option value="${e.id}">${esc(fmtDate(e.starts_at))} — ${esc(e.title)}</option>`).join('');

  type Row = { email: string; prenom: string; nom: string; classe: string; camp: string | null; user_id: string | null; statut: string | null; inscrit: boolean };
  let rows: Row[] = [];
  const { data: membres } = await sb.from('adhesions').select('prenom, nom, classe, email, user_id').order('nom');

  const paint = () => {
    const n = (s: string) => rows.filter((r) => r.statut === s).length;
    $('apCount').textContent = `${n('present')} présent${n('present') > 1 ? 's' : ''} · ${n('absent')} absent${n('absent') > 1 ? 's' : ''} · ${n('excuse')} excusé${n('excuse') > 1 ? 's' : ''} · ${rows.filter((r) => !r.statut).length} à pointer`;
    list.innerHTML = rows.length ? rows.map((r, i) => `<div class="ap-row">
        <div><strong>${esc(r.prenom)} ${esc(r.nom)}</strong> <span class="muted small">${esc(r.classe)}${r.camp ? ` · camp « ${esc(r.camp)} »` : ''}${r.inscrit ? '' : ' · non inscrit'}${r.user_id ? '' : ' · sans compte'}</span></div>
        <div class="ap-btns">${[['present', 'Présent'], ['absent', 'Absent'], ['excuse', 'Excusé']].map(([k, l]) => `<button type="button" class="ap-b ap-${k}${r.statut === k ? ' on' : ''}" data-i="${i}" data-s="${k}">${l}</button>`).join('')}</div></div>`).join('')
      : '<p class="muted">Personne n\'a répondu « Je viens » à cette séance. Ajoute les présents ci-dessous.</p>';
  };
  const load = async () => {
    msg.innerHTML = '';
    const ev = sel.value;
    const [{ data: sg }, { data: pr }] = await Promise.all([
      sb.from('event_signups').select('prenom, nom, classe, email, camp, user_id').eq('event_key', ev).eq('reponse', 'oui').order('camp').order('nom'),
      sb.from('presences').select('email, prenom, nom, classe, camp, user_id, statut').eq('event_key', ev),
    ]);
    const map = new Map<string, Row>();
    (sg || []).forEach((s) => map.set(s.email.toLowerCase(), { ...s, email: s.email.toLowerCase(), statut: null, inscrit: true }));
    (pr || []).forEach((p) => { const k = p.email.toLowerCase(); const r = map.get(k); if (r) r.statut = p.statut; else map.set(k, { ...p, email: k, inscrit: false }); });
    rows = [...map.values()];
    $('apDone').textContent = pr?.length ? `Appel déjà enregistré (${pr.length} personnes) — tu peux le corriger.` : '';
    paint();
  };
  sel.addEventListener('change', load);
  list.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('.ap-b') as HTMLElement | null; if (!b) return; const r = rows[Number(b.dataset.i)]; r.statut = r.statut === b.dataset.s ? null : b.dataset.s!; paint(); });
  $('apAll').addEventListener('click', () => { rows.forEach((r) => { if (!r.statut) r.statut = 'present'; }); paint(); });
  $('apAbs').addEventListener('click', () => { rows.forEach((r) => { if (!r.statut) r.statut = 'absent'; }); paint(); });

  // Ajouter un membre présent qui n'était pas inscrit
  const q = $('apAdd') as HTMLInputElement, res = $('apAddRes');
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase(); if (t.length < 2) { res.innerHTML = ''; return; }
    const found = (membres || []).filter((m) => `${m.prenom} ${m.nom} ${m.classe} ${m.email}`.toLowerCase().includes(t) && !rows.some((r) => r.email === m.email.toLowerCase())).slice(0, 6);
    res.innerHTML = found.map((m) => `<button type="button" class="pill ap-pick" data-e="${esc(m.email)}">+ ${esc(m.prenom)} ${esc(m.nom)} (${esc(m.classe)})</button>`).join(' ') || '<span class="small muted">Aucun membre trouvé.</span>';
  });
  res.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.ap-pick') as HTMLElement | null; if (!b) return;
    const m = (membres || []).find((x) => x.email === b.dataset.e); if (!m) return;
    rows.push({ prenom: m.prenom, nom: m.nom, classe: m.classe, email: m.email.toLowerCase(), user_id: m.user_id, camp: null, statut: 'present', inscrit: false });
    q.value = ''; res.innerHTML = ''; paint();
  });

  $('apSave').addEventListener('click', async () => {
    const lignes = rows.filter((r) => r.statut).map((r) => ({ email: r.email, statut: r.statut, user_id: r.user_id, prenom: r.prenom, nom: r.nom, classe: r.classe }));
    if (!lignes.length) { msg.innerHTML = '<div class="alert alert-err">Pointe au moins une personne.</div>'; return; }
    const reste = rows.filter((r) => !r.statut).length;
    if (reste && !confirm(`${reste} personne(s) ne sont pas pointées et ne seront pas enregistrées. Continuer ?`)) return;
    const b = $('apSave') as HTMLButtonElement; b.disabled = true; msg.innerHTML = '<div class="alert alert-info">Enregistrement…</div>';
    const r = await postJSON<{ exclus: string[]; avertis: string[] }>('/api/appel', { event: sel.value, lignes }, session.access_token);
    b.disabled = false;
    if (!r.ok) { msg.innerHTML = `<div class="alert alert-err">${esc(r.error)}</div>`; return; }
    msg.innerHTML = `<div class="alert alert-ok">Appel enregistré. Les profils d'orateur sont à jour.${r.data.avertis.length ? `<br>Avertissement envoyé par email à : <strong>${r.data.avertis.map(esc).join(', ')}</strong> (prochaine absence = suspension).` : ''}${r.data.exclus.length ? `<br>Compte suspendu automatiquement et prévenu par email : <strong>${r.data.exclus.map(esc).join(', ')}</strong>. Un admin peut le réactiver dans « Membres & rôles ».` : ''}</div>`;
    load();
  });
  load();
}

/* ────────────────────────── Élections ────────────────────────── */
async function initElections(sb: SupabaseClient) {
  const box = $('elList'), form = $('elForm') as HTMLFormElement, msg = $('elMsg');
  ($('elPoste') as HTMLSelectElement).innerHTML = '<option value="">— Autre / plusieurs postes —</option>' + (postes as { titre: string }[]).map((p) => `<option>${esc(p.titre)}</option>`).join('');
  const show = (t: string, k = 'err') => (msg.innerHTML = `<div class="alert alert-${k}">${t}</div>`);
  ($('elPoste') as HTMLSelectElement).addEventListener('change', (e) => { const t = form.elements.namedItem('titre') as HTMLInputElement; const v = (e.target as HTMLSelectElement).value; if (v && !t.value) t.value = `Élection : ${v}`; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!form.checkValidity()) { form.reportValidity(); return; }
    const fd = new FormData(form);
    const ferm = new Date(String(fd.get('fermeture'))); const ouv = fd.get('ouverture') ? new Date(String(fd.get('ouverture'))) : null;
    if (ferm.getTime() <= Date.now()) { show('La clôture doit être dans le futur.'); return; }
    if (ouv && ouv >= ferm) { show("L'ouverture doit précéder la clôture."); return; }
    const { error } = await sb.from('elections').insert({ titre: String(fd.get('titre')).trim(), poste: String(fd.get('poste') || '') || null, description: String(fd.get('description') || '').trim() || null, fermeture: ferm.toISOString(), ouverture: ouv?.toISOString() || null });
    if (error) { show(error.message); return; }
    form.reset(); show('Élection créée en brouillon. Ajoute les candidats, puis ouvre le vote.', 'ok'); load();
  });

  const STAT: Record<string, string> = { brouillon: 'Brouillon', programmee: 'Programmée', ouverte: 'Vote ouvert', close: 'Close' };
  async function load() {
    const [{ data: els, error }, { data: cands }] = await Promise.all([sb.rpc('elections_liste'), sb.from('candidatures').select('prenom, nom, classe, poste, user_id, motivation').eq('statut', 'acceptee')]);
    if (error) { box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; return; }
    box.innerHTML = (els || []).map((e: any) => {
      const brouillon = e.statut === 'brouillon', close = e.statut === 'close';
      const total = (e.candidats || []).reduce((a: number, c: any) => a + (c.voix || 0), 0) + (e.blancs || 0);
      const sugg = (cands || []).filter((c: any) => !e.poste || !c.poste || c.poste === e.poste);
      return `<div class="ev-item">
        <div class="flex between"><div><span class="pill">${STAT[e.statut] || e.statut}</span> <strong>${esc(e.titre)}</strong><br><span class="small muted">${e.ouverture ? `Ouverture ${esc(fmtDT(e.ouverture))} · ` : ''}Clôture ${esc(fmtDT(e.fermeture))}</span></div>
          <div class="flex" style="gap:6px;">
            ${brouillon ? `<button class="btn btn-primary btn-sm el-act" data-a="ouvrir" data-id="${e.id}" type="button">Ouvrir le vote</button><button class="btn btn-outline btn-sm el-del" data-id="${e.id}" type="button">Supprimer</button>` : ''}
            ${e.statut === 'ouverte' || e.statut === 'programmee' ? `<button class="btn btn-outline btn-sm el-act" data-a="clore" data-id="${e.id}" type="button">Clore maintenant</button>` : ''}
            ${close && !e.publiee ? `<button class="btn btn-primary btn-sm el-act" data-a="publier" data-id="${e.id}" type="button">Publier les résultats</button>` : ''}
          </div></div>
        ${!brouillon ? `<div class="ev-stats"><b>${e.votants}</b> votant${e.votants > 1 ? 's' : ''} sur <b>${e.inscrits}</b> inscrits (${e.inscrits ? Math.round((e.votants / e.inscrits) * 100) : 0} %)${close ? (e.publiee ? ' · résultats publiés aux membres' : ' · résultats visibles par le bureau seulement') : ''}</div>` : ''}
        <div class="el-cands">${(e.candidats || []).map((c: any) => `<div class="el-c"><div><strong>${esc(c.nom)}</strong>${c.profession_de_foi ? `<br><span class="small muted">${esc(c.profession_de_foi).slice(0, 200)}${c.profession_de_foi.length > 200 ? '…' : ''}</span>` : ''}</div>
            ${close ? `<div class="el-res"><b>${c.voix}</b> voix · ${total ? Math.round((c.voix / total) * 100) : 0} %</div>` : ''}
            ${brouillon ? `<button class="lnk el-cdel" data-id="${c.id}" type="button">Retirer</button>` : ''}</div>`).join('') || '<p class="small muted">Aucun candidat pour l\'instant.</p>'}
          ${close ? `<div class="el-c"><div class="muted">Votes blancs</div><div class="el-res"><b>${e.blancs}</b></div></div>` : ''}</div>
        ${brouillon ? `<details class="mt-1"><summary>+ Ajouter un candidat</summary><form class="form el-cform" data-id="${e.id}">
            ${sugg.length ? `<div class="field"><label>Candidature acceptée <small>(facultatif)</small></label><select name="pick"><option value="">— saisir à la main —</option>${sugg.map((c: any, i: number) => `<option value="${i}">${esc(c.prenom)} ${esc(c.nom)} (${esc(c.classe)})${c.poste ? ` — ${esc(c.poste)}` : ''}</option>`).join('')}</select></div>` : ''}
            <div class="field"><label>Nom affiché</label><input name="nom" required maxlength="120" placeholder="Prénom Nom (classe)" /></div>
            <div class="field"><label>Profession de foi <small>(facultatif)</small></label><textarea name="pdf" maxlength="3000" style="min-height:80px;"></textarea></div>
            <button class="btn btn-primary btn-sm" type="submit">Ajouter</button></form></details>` : ''}
      </div>`;
    }).join('') || '<p class="muted">Aucune élection pour l\'instant.</p>';

    box.querySelectorAll<HTMLFormElement>('.el-cform').forEach((f) => {
      const pick = f.elements.namedItem('pick') as HTMLSelectElement | null;
      const sugg = (cands || []);
      pick?.addEventListener('change', () => { const c: any = sugg[Number(pick.value)]; if (!c) return; (f.elements.namedItem('nom') as HTMLInputElement).value = `${c.prenom} ${c.nom} (${c.classe})`; (f.elements.namedItem('pdf') as HTMLTextAreaElement).value = c.motivation || ''; });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); const c: any = pick && pick.value ? sugg[Number(pick.value)] : null;
        const { error } = await sb.from('election_candidats').insert({ election_id: f.dataset.id, nom: (f.elements.namedItem('nom') as HTMLInputElement).value.trim(), profession_de_foi: (f.elements.namedItem('pdf') as HTMLTextAreaElement).value.trim() || null, user_id: c?.user_id || null });
        if (error) show(error.message); else load();
      });
    });
  }
  box.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
    if (b.classList.contains('el-cdel')) { const { error } = await sb.from('election_candidats').delete().eq('id', b.dataset.id!); if (error) show(error.message); load(); }
    if (b.classList.contains('el-del')) { if (!confirm('Supprimer ce brouillon ?')) return; await sb.from('elections').delete().eq('id', b.dataset.id!); load(); }
    if (b.classList.contains('el-act')) {
      const conf = { ouvrir: "Ouvrir le vote ? Les candidats ne pourront plus être modifiés. Seuls les membres dont le compte existe déjà pourront voter, une seule fois, à bulletin secret.", clore: 'Clore le vote maintenant ?', publier: 'Publier les résultats à tous les membres ?' }[b.dataset.a as 'ouvrir'];
      if (!confirm(conf)) return;
      const { error } = await sb.rpc('election_action', { p_election: b.dataset.id, p_action: b.dataset.a });
      if (error) show(errFr(error.message)); else { show(b.dataset.a === 'ouvrir' ? 'Vote ouvert : les membres peuvent voter depuis « Élections ».' : b.dataset.a === 'clore' ? 'Vote clos.' : 'Résultats publiés.', 'ok'); load(); }
    }
  });
  load();
}

/* ────────────────────────── Motions ────────────────────────── */
async function initMotions(sb: SupabaseClient) {
  const box = $('moList');
  const STAT: Record<string, string> = { proposee: 'Proposée', retenue: 'Retenue', debattue: 'Débattue', ecartee: 'Écartée' };
  async function load() {
    const { data } = await sb.rpc('motions_liste');
    const ms = ((data as any[]) || []).sort((a, b) => b.votes - a.votes);
    box.innerHTML = ms.length ? `<table class="table"><thead><tr><th>Votes</th><th>Motion</th><th>Proposée par</th><th>Statut</th><th></th></tr></thead><tbody>${ms.map((m) => `<tr>
      <td><strong>${m.votes}</strong></td><td><strong>${esc(m.texte)}</strong>${m.contexte ? `<br><span class="small muted">${esc(m.contexte)}</span>` : ''}</td>
      <td class="small">${esc(m.auteur_nom)}<br><span class="muted">${new Date(m.created_at).toLocaleDateString('fr-FR')}</span></td>
      <td><select class="mo-st" data-id="${m.id}">${Object.entries(STAT).map(([k, l]) => `<option value="${k}" ${k === m.statut ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td style="white-space:nowrap;"><button class="btn btn-outline btn-sm mo-ev" data-t="${esc(m.texte)}" type="button">En faire un débat</button> <button class="lnk mo-del" data-id="${m.id}" type="button">Supprimer</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Aucune motion proposée pour l\'instant. Les membres peuvent en proposer depuis la page « Motions ».</p>';
  }
  box.addEventListener('change', async (e) => { const s = e.target as HTMLSelectElement; if (!s.classList.contains('mo-st')) return; await sb.from('motions').update({ statut: s.value }).eq('id', s.dataset.id!); });
  box.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
    if (b.classList.contains('mo-del')) { if (!confirm('Supprimer cette motion ?')) return; await sb.from('motions').delete().eq('id', b.dataset.id!); load(); }
    if (b.classList.contains('mo-ev')) {
      (document.querySelector('.tab[data-tab="inscr"]') as HTMLButtonElement)?.click();
      const t = document.querySelector('#evCreate [name="title"]') as HTMLInputElement | null; if (t) { t.value = b.dataset.t!; t.focus(); }
    }
  });
  load();
}

/* ────────────────────────── Entre nous ────────────────────────── */
async function initEntreNous(sb: SupabaseClient, me: { id: string; prenom: string; nom: string }) {
  const { data: equipe } = await sb.rpc('bureau_membres');
  const membres = (equipe as any[]) || [];
  const nomDe = (id: string | null) => { const m = membres.find((x) => x.id === id); return m ? `${m.prenom} ${(m.nom || '').slice(0, 1)}.` : '—'; };
  ($('tkAssign') as HTMLSelectElement).innerHTML = '<option value="">Personne</option>' + membres.map((m) => `<option value="${m.id}">${esc(m.prenom)} ${esc(m.nom)}</option>`).join('');
  $('enEquipe').innerHTML = membres.map((m) => `<span class="pill">${esc(m.prenom)} ${esc(m.nom)}${m.role === 'admin' ? ' · admin' : ''}</span>`).join(' ');

  // Tâches
  const tkForm = $('tkForm') as HTMLFormElement, tkBox = $('tkList');
  const COL: [string, string][] = [['a_faire', 'À faire'], ['en_cours', 'En cours'], ['fait', 'Fait']];
  async function loadTk() {
    const { data } = await sb.from('bureau_taches').select('*').order('echeance', { ascending: true, nullsFirst: false }).order('created_at');
    tkBox.innerHTML = COL.map(([k, l]) => { const ts = (data || []).filter((t) => t.statut === k); return `<div class="tk-col"><h4>${l} <span class="muted">${ts.length}</span></h4>${ts.map((t) => {
      const late = t.echeance && t.statut !== 'fait' && new Date(t.echeance + 'T23:59') < new Date();
      return `<div class="tk${t.assigne_a === me.id ? ' tk-moi' : ''}"><strong>${esc(t.titre)}</strong>${t.details ? `<p class="small">${esc(t.details)}</p>` : ''}
        <div class="small muted">${esc(nomDe(t.assigne_a))}${t.echeance ? ` · <span class="${late ? 'tk-late' : ''}">avant le ${new Date(t.echeance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>` : ''}</div>
        <div class="tk-act">${COL.filter(([c]) => c !== k).map(([c, cl]) => `<button class="lnk tk-mv" data-id="${t.id}" data-s="${c}" type="button">→ ${cl}</button>`).join(' ')} <button class="lnk tk-del" data-id="${t.id}" type="button">Supprimer</button></div></div>`; }).join('') || '<p class="small muted">Rien ici.</p>'}</div>`; }).join('');
  }
  tkForm.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(tkForm);
    const { error } = await sb.from('bureau_taches').insert({ titre: String(fd.get('titre')).trim(), details: String(fd.get('details') || '').trim() || null, assigne_a: String(fd.get('assigne') || '') || null, echeance: String(fd.get('echeance') || '') || null, created_by: me.id });
    if (error) alert(error.message); else { tkForm.reset(); loadTk(); }
  });
  tkBox.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
    if (b.classList.contains('tk-mv')) { await sb.from('bureau_taches').update({ statut: b.dataset.s }).eq('id', b.dataset.id!); loadTk(); }
    if (b.classList.contains('tk-del')) { if (confirm('Supprimer cette tâche ?')) { await sb.from('bureau_taches').delete().eq('id', b.dataset.id!); loadTk(); } }
  });
  loadTk();

  // Discussion
  const chat = $('enChat'), chatForm = $('enChatForm') as HTMLFormElement, chatIn = $('enChatIn') as HTMLInputElement;
  async function loadChat() {
    const { data } = await sb.from('bureau_messages').select('*').order('created_at', { ascending: false }).limit(150);
    const bas = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
    chat.innerHTML = (data || []).reverse().map((m) => `<div class="msg${m.auteur === me.id ? ' mien' : ''}">${m.auteur === me.id ? '' : `<b>${esc(m.auteur_nom)}</b>`}<p>${esc(m.contenu)}</p><time>${ago(m.created_at)}</time></div>`).join('') || '<p class="small muted">Pas encore de message. Lance la discussion du bureau.</p>';
    if (bas) chat.scrollTop = chat.scrollHeight;
  }
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = chatIn.value.trim(); if (!v) return; chatIn.value = '';
    const { error } = await sb.from('bureau_messages').insert({ auteur: me.id, auteur_nom: `${me.prenom} ${(me.nom || '').slice(0, 1)}.`, contenu: v });
    if (error) alert(error.message); await loadChat(); chat.scrollTop = chat.scrollHeight;
  });
  loadChat();
  setInterval(() => { if (!document.hidden && !$('tab-entre').classList.contains('hidden')) loadChat(); }, 8000);

  // Notes partagées
  const nList = $('ntList'), nEd = $('ntEditor') as HTMLTextAreaElement, nTitre = $('ntTitre') as HTMLInputElement, nInfo = $('ntInfo');
  let courant: string | null = null;
  async function loadNotes(select?: string) {
    const { data } = await sb.from('bureau_notes').select('id, titre, updated_at, updated_by').order('updated_at', { ascending: false });
    nList.innerHTML = (data || []).map((n) => `<button type="button" class="nt-item${n.id === (select ?? courant) ? ' on' : ''}" data-id="${n.id}"><strong>${esc(n.titre)}</strong><span class="small muted">${esc(n.updated_by || '')} · ${ago(n.updated_at)}</span></button>`).join('') || '<p class="small muted">Aucune note. Crée par exemple « Ordre du jour de la prochaine réunion ».</p>';
    if (select) open(select);
  }
  async function open(id: string) {
    const { data } = await sb.from('bureau_notes').select('*').eq('id', id).single(); if (!data) return;
    courant = id; nTitre.value = data.titre; nEd.value = data.contenu; nInfo.textContent = `Modifiée par ${data.updated_by || '—'} ${ago(data.updated_at)}`;
    $('ntZone').classList.remove('hidden'); nList.querySelectorAll('.nt-item').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === id));
  }
  nList.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('.nt-item') as HTMLElement | null; if (b) open(b.dataset.id!); });
  $('ntNew').addEventListener('click', async () => {
    const t = prompt('Titre de la note (ex. « Réunion du 20 novembre »)'); if (!t?.trim()) return;
    const { data, error } = await sb.from('bureau_notes').insert({ titre: t.trim(), contenu: '', updated_by: `${me.prenom} ${(me.nom || '').slice(0, 1)}.` }).select('id').single();
    if (error) alert(error.message); else loadNotes(data.id);
  });
  $('ntSave').addEventListener('click', async () => {
    if (!courant) return;
    const { error } = await sb.from('bureau_notes').update({ titre: nTitre.value.trim() || 'Sans titre', contenu: nEd.value, updated_by: `${me.prenom} ${(me.nom || '').slice(0, 1)}.`, updated_at: new Date().toISOString() }).eq('id', courant);
    nInfo.textContent = error ? `Erreur : ${error.message}` : 'Enregistré.'; loadNotes();
  });
  $('ntDel').addEventListener('click', async () => {
    if (!courant || !confirm('Supprimer cette note ?')) return;
    await sb.from('bureau_notes').delete().eq('id', courant); courant = null; $('ntZone').classList.add('hidden'); loadNotes();
  });
  loadNotes();
}

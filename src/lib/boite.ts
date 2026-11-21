import type { SupabaseClient } from '@supabase/supabase-js';
import { postJSON } from './newsletter';

// Boîte contact@parlementjpv.fr dans l'espace bureau (administrateurs).
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const quand = (d: string) => {
  const x = new Date(d), now = new Date();
  return x.toDateString() === now.toDateString() ? x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(x.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
const taille = (n: number) => n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`;

export function initBoite(sb: SupabaseClient) {
  let dossier = 'inbox', page = 0, courant: any = null, charge = false;
  const tok = async () => (await sb.auth.getSession()).data.session?.access_token || '';
  const appel = async <T,>(corps: Record<string, unknown>) => postJSON<T>('/api/boite-mail', { dossier, ...corps }, await tok());
  const liste = $('bmListe'), lecteur = $('bmLecteur'), msg = $('bmMsg');

  const chargerListe = async () => {
    liste.innerHTML = '<p class="muted small bm-vide">Chargement…</p>';
    const r = await appel<any>({ action: 'liste', page });
    if (!r.ok) { liste.innerHTML = `<div class="alert alert-err">${esc(r.error || 'Boîte inaccessible.')}</div>`; return; }
    const d = r.data;
    if (dossier === 'inbox') { $('bmNonLus').textContent = d.nonLus ? String(d.nonLus) : ''; const t = document.querySelector('[data-tab="boite"] .bu-tile-d'); if (t) t.textContent = d.nonLus ? `${d.nonLus} message${d.nonLus > 1 ? 's' : ''} non lu${d.nonLus > 1 ? 's' : ''}` : 'Lire et répondre aux emails de contact@parlementjpv.fr'; }
    liste.innerHTML = d.items.length ? d.items.map((m: any) => `<button type="button" class="bm-ligne${m.lu ? '' : ' nonlu'}${courant?.uid === m.uid ? ' actif' : ''}" data-uid="${m.uid}">
        <span class="bm-de">${esc(dossier === 'envoyes' ? `À : ${m.a}` : (m.de?.nom || m.de?.email || 'Inconnu'))}</span><span class="bm-date">${esc(quand(m.date))}</span>
        <span class="bm-sujet">${m.pj ? '📎 ' : ''}${esc(m.sujet)}</span></button>`).join('')
      : '<p class="muted small bm-vide">Aucun message dans ce dossier.</p>';
    $('bmPage').textContent = d.pages > 1 ? `Page ${page + 1} sur ${d.pages}` : '';
    ($('bmPrec') as HTMLButtonElement).disabled = page === 0; ($('bmSuiv') as HTMLButtonElement).disabled = page + 1 >= d.pages;
    liste.querySelectorAll<HTMLButtonElement>('.bm-ligne').forEach((b) => b.addEventListener('click', () => ouvrir(Number(b.dataset.uid))));
  };

  const ouvrir = async (uid: number) => {
    document.querySelector('.bm-boite')!.classList.add('lecture');
    liste.querySelectorAll('.bm-ligne').forEach((x) => x.classList.toggle('actif', Number((x as HTMLElement).dataset.uid) === uid));
    liste.querySelector(`[data-uid="${uid}"]`)?.classList.remove('nonlu');
    lecteur.innerHTML = '<p class="muted small">Ouverture…</p>';
    const r = await appel<any>({ action: 'lire', uid });
    if (!r.ok) { lecteur.innerHTML = `<div class="alert alert-err">${esc(r.error)}</div>`; return; }
    const m = courant = r.data;
    lecteur.innerHTML = `<button type="button" class="btn btn-outline btn-sm bm-retour" id="bmRetour">← Retour à la liste</button>
      <h3 class="bm-titre">${esc(m.sujet)}</h3>
      <p class="small bm-meta"><strong>${esc(m.de?.name || m.de?.address || '')}</strong> ${m.de?.address ? `&lt;${esc(m.de.address)}&gt;` : ''}<br>À : ${esc(m.a)}${m.cc ? `<br>Cc : ${esc(m.cc)}` : ''}<br>${esc(new Date(m.date).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }))}</p>
      ${m.pj.length ? `<div class="bm-pjs">${m.pj.map((a: any) => `<button type="button" class="bm-pj" data-i="${a.i}">📎 ${esc(a.nom)} <span class="muted">${taille(a.taille)}</span></button>`).join('')}</div>` : ''}
      <iframe class="bm-corps" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Contenu du message"></iframe>
      <div class="bm-actions">
        ${dossier !== 'envoyes' ? '<button type="button" class="btn btn-primary btn-sm" id="bmRep">Répondre</button>' : ''}
        <button type="button" class="btn btn-outline btn-sm" id="bmNonLu">Marquer non lu</button>
        ${dossier !== 'corbeille' ? '<button type="button" class="btn btn-outline btn-sm bm-suppr" id="bmSuppr">Supprimer</button>' : ''}
      </div>
      <form class="form hidden bm-repform" id="bmRepForm">
        <div class="field"><label for="bmRepTxt">Réponse à ${esc(m.de?.address || '')}</label><textarea id="bmRepTxt" required style="min-height:160px;" placeholder="Bonjour,&#10;&#10;…"></textarea></div>
        <p class="small muted" style="margin:0;">Envoyée depuis contact@parlementjpv.fr, avec le message d'origine cité en dessous. Une copie est rangée dans « Envoyés ».</p>
        <div class="flex" style="gap:8px;"><button class="btn btn-primary btn-sm" type="submit">Envoyer la réponse</button><button class="btn btn-outline btn-sm" type="button" id="bmRepAnn">Annuler</button></div>
      </form><div id="bmActMsg" aria-live="polite"></div>`;
    // Contenu affiché dans un cadre isolé : aucun script, images distantes bloquées tant qu'on ne les autorise pas
    const f = lecteur.querySelector<HTMLIFrameElement>('.bm-corps')!;
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:; font-src data:">`;
    const base = '<base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f1f4b;margin:0;padding:4px;word-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>';
    const peindre = (images: boolean) => { const c = images ? csp.replace("img-src data: cid:", 'img-src data: cid: https:') : csp; f.srcdoc = m.html ? c + base + m.html : `${c}${base}<pre>${esc(m.texte)}</pre>`; };
    peindre(false);
    if (m.html && /<img[^>]+src=["']?https?:/i.test(m.html)) {
      f.insertAdjacentHTML('beforebegin', '<p class="small muted bm-img">Images masquées pour ta sécurité. <button type="button" class="bm-pj" id="bmImg">Afficher les images</button></p>');
      $('bmImg').addEventListener('click', () => { peindre(true); document.querySelector('.bm-img')?.remove(); });
    }
    f.addEventListener('load', () => { try { f.style.height = Math.min(1400, Math.max(160, f.contentDocument!.body.scrollHeight + 20)) + 'px'; } catch { f.style.height = '420px'; } });
    $('bmRetour').addEventListener('click', () => document.querySelector('.bm-boite')!.classList.remove('lecture'));
    lecteur.querySelectorAll<HTMLButtonElement>('.bm-pj').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; const r2 = await appel<any>({ action: 'pj', uid, i: Number(b.dataset.i) }); b.disabled = false;
      if (!r2.ok) return alert(r2.error || 'Téléchargement impossible.');
      const bin = Uint8Array.from(atob(r2.data.base64), (c) => c.charCodeAt(0));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bin], { type: r2.data.type })); a.download = r2.data.nom; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }));
    const form = $('bmRepForm') as HTMLFormElement, am = $('bmActMsg');
    $('bmRep')?.addEventListener('click', () => { form.classList.remove('hidden'); ($('bmRepTxt') as HTMLTextAreaElement).focus(); });
    $('bmRepAnn').addEventListener('click', () => form.classList.add('hidden'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = form.querySelector('button[type=submit]') as HTMLButtonElement; btn.disabled = true; btn.textContent = 'Envoi…';
      const r3 = await appel<any>({ action: 'repondre', uid, texte: ($('bmRepTxt') as HTMLTextAreaElement).value });
      btn.disabled = false; btn.textContent = 'Envoyer la réponse';
      if (!r3.ok) { am.innerHTML = `<div class="alert alert-err">${esc(r3.error)}</div>`; return; }
      form.classList.add('hidden'); am.innerHTML = `<div class="alert alert-ok">Réponse envoyée à ${esc(r3.data.a)}.</div>`;
    });
    $('bmNonLu').addEventListener('click', async () => { await appel({ action: 'nonlu', uid }); am.innerHTML = '<div class="alert alert-ok">Marqué comme non lu.</div>'; chargerListe(); });
    $('bmSuppr')?.addEventListener('click', async () => {
      if (!confirm('Mettre ce message à la corbeille ?')) return;
      const r4 = await appel<any>({ action: 'supprimer', uid });
      if (!r4.ok) { am.innerHTML = `<div class="alert alert-err">${esc(r4.error)}</div>`; return; }
      courant = null; lecteur.innerHTML = '<p class="muted small">Message mis à la corbeille.</p>'; document.querySelector('.bm-boite')!.classList.remove('lecture'); chargerListe();
    });
  };

  document.querySelectorAll<HTMLButtonElement>('.bm-dossier').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.bm-dossier').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    dossier = b.dataset.d!; page = 0; courant = null; lecteur.innerHTML = '<p class="muted small">Choisis un message à gauche.</p>'; document.querySelector('.bm-boite')!.classList.remove('lecture'); chargerListe();
  }));
  $('bmRefresh').addEventListener('click', chargerListe);
  $('bmNouveau').addEventListener('click', () => {
    courant = null; liste.querySelectorAll('.bm-ligne').forEach((x) => x.classList.remove('actif'));
    document.querySelector('.bm-boite')!.classList.add('lecture');
    lecteur.innerHTML = `<button type="button" class="btn btn-outline btn-sm bm-retour" id="bmRetour">← Retour à la liste</button>
      <h3 class="bm-titre">Nouveau message</h3>
      <form class="form" id="bmNvForm">
        <div class="field"><label for="bmA">À</label><input id="bmA" type="text" required placeholder="prenom.nom@exemple.fr" autocomplete="off" /><span class="small muted">Plusieurs adresses : sépare-les par une virgule.</span></div>
        <div class="field"><label for="bmCc">Cc <span class="small muted">(facultatif)</span></label><input id="bmCc" type="text" autocomplete="off" /></div>
        <div class="field"><label for="bmSujet">Objet</label><input id="bmSujet" required maxlength="200" /></div>
        <div class="field"><label for="bmTxt">Message</label><textarea id="bmTxt" required style="min-height:220px;" placeholder="Bonjour,&#10;&#10;…"></textarea></div>
        <p class="small muted" style="margin:0;">Envoyé depuis contact@parlementjpv.fr, avec la signature du Parlement. Une copie est rangée dans « Envoyés ».</p>
        <div id="bmNvMsg" aria-live="polite"></div>
        <div class="flex" style="gap:8px;"><button class="btn btn-primary btn-sm" type="submit">Envoyer</button><button class="btn btn-outline btn-sm" type="button" id="bmNvAnn">Annuler</button></div>
      </form>`;
    const fermer = () => { document.querySelector('.bm-boite')!.classList.remove('lecture'); lecteur.innerHTML = '<p class="muted small">Choisis un message à gauche.</p>'; };
    $('bmRetour').addEventListener('click', fermer); $('bmNvAnn').addEventListener('click', fermer);
    ($('bmA') as HTMLInputElement).focus();
    $('bmNvForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = ($('bmA') as HTMLInputElement).value, sujet = ($('bmSujet') as HTMLInputElement).value;
      if (!confirm(`Envoyer « ${sujet} » à ${a} ?`)) return;
      const btn = (e.target as HTMLFormElement).querySelector('button[type=submit]') as HTMLButtonElement; btn.disabled = true; btn.textContent = 'Envoi…';
      const r = await postJSON<any>('/api/boite-mail', { action: 'envoyer', a, cc: ($('bmCc') as HTMLInputElement).value, sujet, texte: ($('bmTxt') as HTMLTextAreaElement).value }, await tok());
      btn.disabled = false; btn.textContent = 'Envoyer';
      if (!r.ok) { $('bmNvMsg').innerHTML = `<div class="alert alert-err">${esc(r.error || 'Envoi impossible.')}</div>`; return; }
      lecteur.innerHTML = `<div class="alert alert-ok">Message envoyé à ${esc(r.data.a)}. Une copie est dans « Envoyés ».</div>`;
      if (dossier === 'envoyes') chargerListe();
    });
  });
  $('bmPrec').addEventListener('click', () => { page--; chargerListe(); });
  $('bmSuiv').addEventListener('click', () => { page++; chargerListe(); });
  // Chargement au premier affichage de l'onglet
  document.querySelector('[data-tab="boite"]')?.addEventListener('click', () => { if (!charge) { charge = true; chargerListe(); } });
  if (msg) msg.textContent = '';
  // Compteur de non lus sur la tuile, sans attendre l'ouverture
  appel<any>({ action: 'liste', page: 0 }).then((r) => { if (r.ok && r.data.nonLus) { const t = document.querySelector('[data-tab="boite"] .bu-tile-d'); if (t) t.textContent = `${r.data.nonLus} message${r.data.nonLus > 1 ? 's' : ''} non lu${r.data.nonLus > 1 ? 's' : ''}`; } });
}

// Fenêtre de signature manuscrite (doigt, stylet ou souris). Renvoie un PNG en data URL, ou null si annulé.
export function demanderSignature(opts: { titre: string; texte: string; valider?: string; annuler?: string | null }): Promise<string | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sig-dialog';
    d.innerHTML = `<form method="dialog" class="sig-box">
      <h2 class="sig-t"></h2><p class="sig-p small"></p>
      <div class="sig-zone"><canvas width="900" height="300" aria-label="Zone de signature : dessine ta signature avec le doigt ou la souris"></canvas><span class="sig-ligne" aria-hidden="true"></span><span class="sig-vide small muted">Signe ici</span></div>
      <div class="sig-err small" role="alert"></div>
      <div class="sig-actions"><button type="button" class="btn btn-outline btn-sm sig-clear">Effacer</button><span class="sig-sp"></span>
        ${opts.annuler === null ? '' : '<button type="button" class="btn btn-outline btn-sm sig-cancel"></button>'}<button type="button" class="btn btn-primary btn-sm sig-ok"></button></div>
    </form>`;
    (d.querySelector('.sig-t') as HTMLElement).textContent = opts.titre;
    (d.querySelector('.sig-p') as HTMLElement).textContent = opts.texte;
    (d.querySelector('.sig-ok') as HTMLElement).textContent = opts.valider || 'Valider ma signature';
    const cancel = d.querySelector('.sig-cancel') as HTMLElement | null; if (cancel) cancel.textContent = opts.annuler || 'Annuler';
    document.body.appendChild(d);
    const cv = d.querySelector('canvas') as HTMLCanvasElement, ctx = cv.getContext('2d')!;
    const vide = d.querySelector('.sig-vide') as HTMLElement, err = d.querySelector('.sig-err') as HTMLElement;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f1f4b'; ctx.lineWidth = 5;
    let dessine = false, traits = 0, last: [number, number] | null = null;
    const pos = (e: PointerEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); dessine = true; last = pos(e); traits++; vide.style.display = 'none'; err.textContent = ''; });
    cv.addEventListener('pointermove', (e) => { if (!dessine || !last) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; });
    const fin = () => { dessine = false; last = null; };
    cv.addEventListener('pointerup', fin); cv.addEventListener('pointercancel', fin);
    const fermer = (v: string | null) => { d.close(); d.remove(); resolve(v); };
    d.querySelector('.sig-clear')!.addEventListener('click', () => { ctx.clearRect(0, 0, cv.width, cv.height); traits = 0; vide.style.display = ''; });
    cancel?.addEventListener('click', () => fermer(null));
    d.addEventListener('cancel', (e) => { if (opts.annuler === null) e.preventDefault(); else fermer(null); });
    d.querySelector('.sig-ok')!.addEventListener('click', () => {
      if (!traits) { err.textContent = 'Dessine ta signature dans le cadre.'; return; }
      fermer(rogner(cv));
    });
    d.showModal();
  });
}

// Recadre la signature au plus près du tracé (fichier plus léger, signature plus grande sur le certificat)
function rogner(cv: HTMLCanvasElement) {
  const { width: w, height: h } = cv, px = cv.getContext('2d')!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = 8; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w, x1 + m); y1 = Math.min(h, y1 + m);
  const out = document.createElement('canvas'); out.width = Math.max(1, x1 - x0); out.height = Math.max(1, y1 - y0);
  out.getContext('2d')!.drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

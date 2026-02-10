/* ========= THEME ========= */
const root = document.documentElement;
const savedTheme = localStorage.getItem("theme");
if (savedTheme) root.setAttribute("data-theme", savedTheme);

function toggleTheme(){
  const current = root.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

/* ========= MOBILE NAV ========= */
function toggleMobile(){
  const m = document.getElementById("mobileNav");
  if (!m) return;
  m.classList.toggle("open");
}

/* ========= HELPERS ========= */
function fmtDateFR(iso){
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle:"full" }).format(d);
}
function fmtDateLongFR(iso){
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle:"long" }).format(d);
}
function fmtTimeFR(iso){
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", { timeStyle:"short" }).format(d);
}
function isFuture(iso){
  return new Date(iso).getTime() >= Date.now() - 60_000;
}
function safeText(s){
  return (s || "").toString();
}

/* ========= LOAD EVENTS + STATS ========= */
async function loadEvents(){
  const el = document.getElementById("upcomingEvents");

  // stats (sur index)
  const statParticipants = document.getElementById("statParticipants");
  const statDebates = document.getElementById("statDebates");
  const statConfs = document.getElementById("statConfs");
  const statActions = document.getElementById("statActions");

  try{
    const res = await fetch("data/events.json", { cache:"no-store" });
    if(!res.ok) throw new Error("events.json not found");
    const data = await res.json();

    // ✅ STATS
    if(statParticipants) statParticipants.textContent = data.stats?.participants ?? "—";
    if(statDebates) statDebates.textContent = data.stats?.debates ?? "—";
    if(statConfs) statConfs.textContent = data.stats?.conferences ?? "—";
    if(statActions) statActions.textContent = data.stats?.actions ?? "—";

    // ✅ LISTE “À venir”
    if(el){
      const upcoming = (data.events || [])
        .filter(e => isFuture(e.start))
        .sort((a,b)=> new Date(a.start)-new Date(b.start))
        .slice(0,4);

      if(upcoming.length === 0){
        el.innerHTML = `<div class="notice">Aucun événement à venir n’est publié pour le moment.</div>`;
        return;
      }

      el.innerHTML = upcoming.map(e => `
        <div class="item">
          <div class="left">
            <div class="title">${safeText(e.title)}</div>
            <div class="meta">${fmtDateFR(e.start)} • ${fmtTimeFR(e.start)} — ${fmtTimeFR(e.end)} • ${safeText(e.location || "Lycée Jean-Pierre Vernant")}</div>
            ${e.tag ? `<span class="badge">${safeText(e.tag)}</span>` : ``}
          </div>
          <div class="pill">${safeText(e.type || "Événement")}</div>
        </div>
      `).join("");
    }
  } catch(err){
    if(el) el.innerHTML = `<div class="notice">Impossible de charger les événements. Vérifie <strong>/data/events.json</strong>.</div>`;
    console.error(err);
  }
}

/* ========= LOAD REPORTS ========= */
async function loadReports(){
  const el = document.getElementById("reportsList");
  if(!el) return;

  try{
    const res = await fetch("data/reports.json", { cache:"no-store" });
    if(!res.ok) throw new Error("reports.json not found");
    const data = await res.json();

    const items = (data.reports || [])
      .sort((a,b)=> new Date(b.date)-new Date(a.date));

    if(items.length === 0){
      el.innerHTML = `<div class="notice">Aucun rapport publié pour le moment.</div>`;
      return;
    }

    el.innerHTML = `
      <table class="table">
        ${items.map(r => `
          <tr>
            <td style="width:220px"><strong>${fmtDateLongFR(r.date)}</strong></td>
            <td>
              <div style="font-weight:900">${safeText(r.title)}</div>
              <div class="small">${safeText(r.summary)}</div>
            </td>
            <td style="width:160px;text-align:right">
              <a class="btn btn-primary" href="${r.file}" target="_blank" rel="noopener">Télécharger</a>
            </td>
          </tr>
        `).join("")}
      </table>
    `;
  } catch(err){
    el.innerHTML = `<div class="notice">Impossible de charger les rapports. Vérifie <strong>/data/reports.json</strong>.</div>`;
    console.error(err);
  }
}

/* ========= LOAD GALLERY (AFFICHE TOUT) ========= */
async function loadGallery(){
  const el = document.getElementById("galleryBlocks");
  if(!el) return;

  try{
    const res = await fetch("data/gallery.json", { cache:"no-store" });
    if(!res.ok) throw new Error("gallery.json introuvable");
    const data = await res.json();

    const albums = (data.albums || [])
      .sort((a,b)=> new Date(b.date) - new Date(a.date));

    if(albums.length === 0){
      el.innerHTML = `<div class="notice">Aucun album publié pour le moment.</div>`;
      return;
    }

    // ✅ pas de slice = toutes les photos
    el.innerHTML = albums.map(a => {
      const itemsHTML = (a.items || []).map(it => {
        if(it.type === "video"){
          return `
            <div class="card" style="padding:0;overflow:hidden">
              <iframe
                src="${it.src}"
                style="width:100%;height:260px;border:0"
                title="${safeText(it.alt || a.title)}"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowfullscreen>
              </iframe>
            </div>
          `;
        }

        return `
          <div class="card" style="padding:0;overflow:hidden">
            <img
              src="${it.src}"
              alt="${safeText(it.alt || a.title)}"
              loading="lazy"
              style="width:100%;height:260px;object-fit:cover;display:block">
          </div>
        `;
      }).join("");

      return `
        <div class="card">
          <div class="kicker">${fmtDateLongFR(a.date)}</div>
          <h3>${safeText(a.title)}</h3>
          <p>${safeText(a.summary)}</p>

          <div class="grid grid-3" style="margin-top:12px">
            ${itemsHTML}
          </div>

          ${a.moreLink ? `
            <div class="btns">
              <a class="btn btn-ghost" href="${a.moreLink}" target="_blank" rel="noopener">Voir plus</a>
            </div>
          ` : ``}
        </div>
      `;
    }).join("");

  } catch(err){
    el.innerHTML = `<div class="notice">Impossible de charger la galerie. Vérifie <strong>/data/gallery.json</strong> et les chemins.</div>`;
    console.error(err);
  }
}

/* ========= INIT ========= */
window.addEventListener("DOMContentLoaded", () => {
  if(!root.getAttribute("data-theme")){
    root.setAttribute("data-theme", "light");
  }
  loadEvents();
  loadReports();
  loadGallery();
});

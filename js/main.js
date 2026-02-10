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
  return new Intl.DateTimeFormat("fr-FR",{dateStyle:"long"}).format(d);
}
function fmtTimeFR(iso){
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR",{timeStyle:"short"}).format(d);
}
function isFuture(iso){
  return new Date(iso).getTime() >= Date.now() - 60000;
}
function safeText(s){
  return (s || "").toString();
}

/* ========= EVENTS ========= */
async function loadEvents(){
  const el = document.getElementById("upcomingEvents");
  if(!el) return;

  try{
    const res = await fetch("data/events.json",{cache:"no-store"});
    const data = await res.json();

    const upcoming = (data.events || [])
      .filter(e=>isFuture(e.start))
      .sort((a,b)=> new Date(a.start)-new Date(b.start));

    if(upcoming.length===0){
      el.innerHTML=`<div class="notice">Aucun événement à venir.</div>`;
      return;
    }

    el.innerHTML = upcoming.map(e=>`
      <div class="item">
        <div class="left">
          <div class="title">${e.title}</div>
          <div class="meta">${fmtDateFR(e.start)} • ${fmtTimeFR(e.start)}</div>
        </div>
        <div class="pill">${e.type}</div>
      </div>
    `).join("");

  }catch(err){
    el.innerHTML=`<div class="notice">Erreur chargement événements.</div>`;
  }
}

/* ========= REPORTS ========= */
async function loadReports(){
  const el=document.getElementById("reportsList");
  if(!el) return;

  try{
    const res=await fetch("data/reports.json",{cache:"no-store"});
    const data=await res.json();

    const items=(data.reports||[]).sort((a,b)=>new Date(b.date)-new Date(a.date));

    el.innerHTML=`
      <table class="table">
        ${items.map(r=>`
          <tr>
            <td style="width:220px"><strong>${fmtDateFR(r.date)}</strong></td>
            <td>
              <div style="font-weight:900">${r.title}</div>
              <div class="small">${r.summary||""}</div>
            </td>
            <td style="width:160px;text-align:right">
              <a class="btn btn-primary" href="${r.file}" target="_blank">Télécharger</a>
            </td>
          </tr>
        `).join("")}
      </table>
    `;
  }catch{
    el.innerHTML=`<div class="notice">Erreur chargement rapports.</div>`;
  }
}

/* ========= GALERIE ========= */
async function loadGallery(){
  const el=document.getElementById("galleryBlocks");
  if(!el) return;

  try{
    const res=await fetch("data/gallery.json",{cache:"no-store"});
    const data=await res.json();

    const albums=(data.albums||[]).sort((a,b)=>new Date(b.date)-new Date(a.date));

    el.innerHTML=albums.map(a=>{
      const itemsHTML=(a.items||[]).map(it=>{
        if(it.type==="video"){
          return `
          <div class="card" style="padding:0;overflow:hidden">
            <iframe src="${it.src}" style="width:100%;height:260px;border:0" allowfullscreen></iframe>
          </div>`;
        }
        return `
        <div class="card" style="padding:0;overflow:hidden">
          <img src="${it.src}" alt="${safeText(it.alt)}" style="width:100%;height:260px;object-fit:cover">
        </div>`;
      }).join("");

      return `
      <div class="card">
        <div class="kicker">${fmtDateFR(a.date)}</div>
        <h3>${safeText(a.title)}</h3>
        <p>${safeText(a.summary)}</p>

        <div class="grid grid-3" style="margin-top:12px">
          ${itemsHTML}
        </div>

        ${a.moreLink?`
        <div class="btns">
          <a class="btn btn-ghost" href="${a.moreLink}" target="_blank">Voir plus</a>
        </div>`:""}
      </div>`;
    }).join("");

  }catch(err){
    el.innerHTML=`<div class="notice">Erreur chargement galerie.</div>`;
    console.error(err);
  }
}

/* ========= INIT GLOBAL ========= */
window.addEventListener("DOMContentLoaded",()=>{
  if(!root.getAttribute("data-theme")){
    root.setAttribute("data-theme","light");
  }
  loadEvents();
  loadReports();
  loadGallery();
});

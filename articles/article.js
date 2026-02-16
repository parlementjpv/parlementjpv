(async function(){
  const list = document.getElementById("list");
  try{
    const res = await fetch("/articles/index.json", { cache: "no-store" });
    if(!res.ok) throw new Error("index.json introuvable");
    const items = await res.json();

    if(!items.length){
      list.innerHTML = `<div class="card"><div class="meta">Aucun article pour l’instant.</div></div>`;
      return;
    }

    list.innerHTML = items.map(it => `
      <a class="card" href="${it.url}" style="display:block">
        ${it.coverUrl ? `<img class="cover" src="${it.coverUrl}" alt="">` : `<div class="cover"></div>`}
        <h2>${escapeHtml(it.title)}</h2>
        <div class="meta">Par ${escapeHtml(it.author)} • ${new Date(it.dateISO).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>
        ${it.excerpt ? `<div class="excerpt">${escapeHtml(it.excerpt)}</div>` : ""}
      </a>
    `).join("");
  } catch(e){
    list.innerHTML = `<div class="card"><div class="meta">Erreur : ${escapeHtml(e.message)}</div></div>`;
  }

  function escapeHtml(s){
    return (s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  }
})();

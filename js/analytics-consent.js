/* =========================================================
   GA4 — Charge uniquement après consentement
   Stockage: localStorage
   ========================================================= */

const GA_MEASUREMENT_ID = "G-SJZ6CRDLPS"; // <-- remplace

function hasAnalyticsConsent(){
  return localStorage.getItem("cookie_consent_analytics") === "yes";
}

function loadGA4(){
  if (window.__gaLoaded) return;
  window.__gaLoaded = true;

  // Inject gtag script
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);

  // Init gtag
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID, {
    anonymize_ip: true // utile, mais ne remplace pas le consentement
  });
}

// Si déjà accepté auparavant → on charge GA direct
if (hasAnalyticsConsent()){
  loadGA4();
}

// Export pour le bandeau
window.__parlementJPV_loadGA4 = loadGA4;


/* =========================================================
   COOKIE WALL UI — force un choix (Accepter ou Continuer sans)
   ========================================================= */
function hasMadeChoice(){
  const v = localStorage.getItem("cookie_consent_analytics");
  return v === "yes" || v === "no";
}

function showCookieWall(){
  const wall = document.getElementById("cookieWall");
  if (!wall) return;
  wall.hidden = false;
  document.documentElement.classList.add("cookies-locked");
  document.body.style.overflow = "hidden";
}

function hideCookieWall(){
  const wall = document.getElementById("cookieWall");
  if (!wall) return;
  wall.hidden = true;
  document.documentElement.classList.remove("cookies-locked");
  document.body.style.overflow = "";
}

document.addEventListener("DOMContentLoaded", () => {
  const wall = document.getElementById("cookieWall");
  if (!wall) return;

  const acceptBtn = wall.querySelector("[data-cookie-accept]");
  const declineBtn = wall.querySelector("[data-cookie-decline]");

  if (acceptBtn){
    acceptBtn.addEventListener("click", () => {
      localStorage.setItem("cookie_consent_analytics", "yes");
      try { loadGA4(); } catch (e) {}
      hideCookieWall();
    });
  }

  if (declineBtn){
    declineBtn.addEventListener("click", () => {
      localStorage.setItem("cookie_consent_analytics", "no");
      hideCookieWall();
    });
  }

  // Si pas de choix -> on affiche la modale
  if (!hasMadeChoice()){
    showCookieWall();
  } else {
    // choix déjà fait -> on ne bloque pas
    hideCookieWall();
  }
});

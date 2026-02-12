/* =========================================================
   GA4 — Charge uniquement après consentement
   Stockage: localStorage
   ========================================================= */

const GA_MEASUREMENT_ID = "G-XXXXXXXXXX"; // <-- remplace

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

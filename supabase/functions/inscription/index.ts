import { createChallenge, verifySolution } from 'npm:altcha-lib@1';
import { admin, sendMail, json, esc, layout, button, SITE, FROM, cors, readJson, isEmail } from '../_shared/lib.ts';

// Inscription protégée par « Je ne suis pas un robot » (ALTCHA : preuve de travail, sans cookie ni service tiers).
// GET  → un défi à résoudre ; POST {action:'creer'} → vérifie le défi puis crée le compte et envoie l'email d'activation ;
// POST {action:'renvoyer'} → renvoie un lien d'activation (même vérification). Les inscriptions directes sont désactivées.
const KEY = () => Deno.env.get('ALTCHA_HMAC_KEY')!;
const retour = (r: unknown) => (typeof r === 'string' && /^https:\/\/(www\.)?parlementjpv\.fr\/|^http:\/\/localhost(:\d+)?\//.test(r) ? r : `${SITE}/compte?bienvenue=1`);
const vus = new Map<string, number>();

async function envoyerActivation(email: string, prenom: string, lien: string) {
  await sendMail({ from: FROM, to: email, subject: 'Active ton compte Parlement JPV',
    html: layout({ title: `Bienvenue au Parlement JPV${prenom ? `, ${esc(prenom)}` : ''}`, body:
      `<p>Un dernier clic pour activer ton compte et devenir membre de l’instance : tu pourras ensuite répondre aux séances, préparer les débats avec ton camp et candidater au bureau.</p>
       ${button(lien, 'Activer mon compte')}
       <p style="font-size:13px;color:#5d6477;">Le lien est valable 24 h. Si tu n’es pas à l’origine de cette demande, ignore simplement cet email.</p>` }) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method === 'GET') {
    const c = await createChallenge({ hmacKey: KEY(), maxNumber: 80000, expires: new Date(Date.now() + 10 * 60 * 1000) });
    return json(req, 200, c);
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'Méthode non autorisée' });
  const b = await readJson(req);
  const robot = { error: 'Coche « Je ne suis pas un robot » avant de continuer.', code: 'robot' };
  if (!b?.altcha || typeof b.altcha !== 'string') return json(req, 400, robot);
  let ok = false; try { ok = await verifySolution(b.altcha, KEY(), true); } catch { ok = false; }
  if (!ok) return json(req, 400, robot);
  if (vus.has(b.altcha)) return json(req, 400, robot);  // un défi ne sert qu'une fois
  vus.set(b.altcha, Date.now()); if (vus.size > 5000) vus.clear();

  const email = String(b.email || '').trim().toLowerCase();
  if (!isEmail(email)) return json(req, 400, { error: 'Adresse email invalide.' });
  const db = admin();

  if (b.action === 'renvoyer') {
    const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: retour(b.redirectTo) } });
    // Réponse identique que le compte existe ou non (on ne révèle pas qui est inscrit)
    if (!error && data?.properties?.action_link && !data.user?.email_confirmed_at) {
      try { await envoyerActivation(email, String(data.user?.user_metadata?.prenom || ''), data.properties.action_link); } catch (e) { console.error(e); }
    }
    return json(req, 200, { ok: true });
  }

  const password = String(b.password || '');
  if (password.length < 8) return json(req, 400, { error: 'Le mot de passe doit faire au moins 8 caractères.' });
  const meta = b.data && typeof b.data === 'object' ? b.data : {};
  const data = {
    prenom: String(meta.prenom || '').trim().slice(0, 80), nom: String(meta.nom || '').trim().slice(0, 80), classe: String(meta.classe || '').trim().slice(0, 40),
    niveau: ['Seconde', 'Première', 'Terminale', 'Personnel', 'Autre'].includes(meta.niveau) ? meta.niveau : '',
    classe_num: Number.isInteger(Number(meta.classe_num)) && Number(meta.classe_num) >= 1 && Number(meta.classe_num) <= 20 ? Number(meta.classe_num) : null,
    telephone: String(meta.telephone || '').trim().slice(0, 30), interets: Array.isArray(meta.interets) ? meta.interets.map(String).slice(0, 12) : [], newsletter: !!meta.newsletter,
  };
  if (!data.prenom || !data.nom || !data.classe) return json(req, 400, { error: 'Prénom, nom et classe sont obligatoires.' });
  if (['Seconde', 'Première', 'Terminale'].includes(data.niveau) && !data.classe_num) return json(req, 400, { error: 'Indique le numéro de ta classe.' });
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'signup', email, password, options: { data, redirectTo: retour(b.redirectTo) } });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('already') || m.includes('registered') || m.includes('exists')) return json(req, 409, { error: 'already registered' });
    if (m.includes('password')) return json(req, 400, { error: error.message });
    console.error(error); return json(req, 500, { error: "Le compte n'a pas pu être créé. Réessaie dans un instant." });
  }
  try { await envoyerActivation(email, data.prenom, link.properties.action_link); }
  catch (e) { console.error(e); return json(req, 200, { ok: true, warning: "Compte créé, mais l'email d'activation n'a pas pu partir : utilise « Renvoyer l'email » sur la page de connexion." }); }
  return json(req, 200, { ok: true });
});

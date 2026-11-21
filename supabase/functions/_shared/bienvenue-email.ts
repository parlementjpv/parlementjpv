// Email de bienvenue (modèle C2 retenu le 21/11/2026).
import { layout, button, esc, SITE } from '../_shared/lib.ts';

const WA = 'https://chat.whatsapp.com/DgbCKPKUfR17UUqv4DIPoI';
const vert = (txt: string) => `<a href="${WA}" style="display:inline-block;background:#25d366;color:#ffffff;font-weight:800;font-size:16px;padding:14px 26px;text-decoration:none;border-radius:8px;">${txt}</a>`;
const h2 = (t: string) => `<h2 style="font-size:20px;line-height:1.2;margin:30px 0 10px;color:#0f1f4b;">${t}</h2>`;
const p = (t: string, s = '') => `<p style="margin:0 0 12px;${s}">${t}</p>`;
const petit = (t: string) => `<p style="margin:0 0 12px;font-size:13px;color:#5d6477;">${t}</p>`;
const lien = (u: string, t: string) => `<a href="${u}" style="color:#d62839;font-weight:700;">${t}</a>`;
const installation = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;"><tr>
    <td style="vertical-align:top;padding:0 10px 0 0;width:50%;"><strong>Sur iPhone (Safari)</strong><br>1. Ouvre ${lien(`${SITE}/application`, 'parlementjpv.fr/application')} dans Safari<br>2. Touche <strong>Partager</strong> (carré avec une flèche)<br>3. Choisis <strong>« Sur l'écran d'accueil »</strong><br>4. Ouvre l'app, connecte-toi, puis <strong>« Activer »</strong> les notifications</td>
    <td style="vertical-align:top;padding:0 0 0 10px;width:50%;"><strong>Sur Android (Chrome)</strong><br>1. Ouvre ${lien(`${SITE}/application`, 'la page d\'installation')} dans Chrome<br>2. Touche <strong>« Installer l'application »</strong><br>3. Ouvre l'app, connecte-toi, puis <strong>« Activer »</strong> les notifications</td>
  </tr></table>`;
const carte = (titre: string, texte: string, url: string, cta: string) => `<td style="vertical-align:top;padding:6px;width:50%;"><div style="border:2px solid #e9ebf0;border-radius:10px;padding:14px 16px;height:100%;"><div style="font-weight:800;font-size:15px;margin-bottom:4px;">${titre}</div><div style="font-size:14px;color:#3b4460;margin-bottom:8px;">${texte}</div><a href="${url}" style="color:#d62839;font-weight:700;font-size:14px;">${cta} →</a></div></td>`;
const grille = (cartes: string[]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;">${cartes.reduce((acc: string[], c, i) => { if (i % 2 === 0) acc.push(''); acc[acc.length - 1] += c; return acc; }, []).map((r) => `<tr>${r}</tr>`).join('')}</table>`;

/** C2 — version institutionnelle de C. */
export function emailBienvenue(prenom: string) {
  const P = esc(prenom || '');
  const rub = (n: string, t: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:34px 0 14px;"><tr><td style="width:34px;vertical-align:middle;"><div style="width:26px;height:26px;line-height:26px;border:2px solid #d62839;color:#d62839;font-weight:800;font-size:13px;text-align:center;border-radius:4px;">${n}</div></td><td style="vertical-align:middle;font-size:19px;font-weight:800;color:#0f1f4b;letter-spacing:-0.01em;">${t}</td></tr><tr><td colspan="2" style="padding-top:10px;"><div style="height:2px;background:#0f1f4b;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>`;
  const chiffre = (n: string, l: string, bord = true) => `<td style="padding:22px 10px;text-align:center;width:33%;${bord ? 'border-right:1px solid rgba(255,255,255,0.18);' : ''}"><div style="font-size:34px;line-height:1;font-weight:800;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">${n}</div><div style="font-size:12px;line-height:1.4;color:#c9cfe0;margin-top:8px;">${l}</div></td>`;
  const temps = (k: string, t: string, dernier = false) => `<tr><td style="vertical-align:top;padding:0 14px ${dernier ? 0 : 16}px 0;width:118px;"><div style="font-size:12px;font-weight:800;color:#d62839;border-top:3px solid #d62839;padding-top:6px;">${k}</div></td><td style="vertical-align:top;padding:0 0 ${dernier ? 0 : 16}px;font-size:15px;line-height:1.55;color:#24304f;border-top:1px solid #e9ebf0;padding-top:8px;">${t}</td></tr>`;
  const module = (titre: string, texte: string, url: string, cta: string) => `<td style="vertical-align:top;padding:6px;width:50%;"><div style="border:1px solid #d9dce3;border-left:4px solid #0f1f4b;border-radius:6px;padding:14px 16px;"><div style="font-weight:800;font-size:15px;color:#0f1f4b;margin-bottom:4px;">${titre}</div><div style="font-size:13.5px;line-height:1.5;color:#4a5370;margin-bottom:10px;">${texte}</div><a href="${url}" style="color:#d62839;font-weight:700;font-size:13.5px;text-decoration:none;">${cta} ›</a></div></td>`;
  const modules = [
    module('Motions', 'Propose les sujets à débattre et soutiens ceux des autres membres.', `${SITE}/motions`, 'Proposer une motion'),
    module('Tournoi d\'éloquence', 'Des duels oratoires, du premier tour jusqu\'à la finale.', `${SITE}/tournoi`, 'Découvrir le tournoi'),
    module('Sorties institutionnelles', 'Assemblée nationale, Sénat, tribunal : visites sur inscription.', `${SITE}/sorties`, 'Voir les sorties'),
    module('Profil d\'orateur', 'Séances, rôles tenus et 22 distinctions à obtenir.', `${SITE}/profil`, 'Ouvrir mon profil'),
    module('Sondages', 'Le bureau consulte les membres, de façon anonyme.', `${SITE}/sondages`, 'Répondre'),
    module('Écrire au bureau', 'Contacter un membre du bureau ou déposer une idée anonyme.', `${SITE}/ecrire-au-bureau`, 'Écrire'),
  ];
  const grilleM = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;">${[0, 2, 4].map((i) => `<tr>${modules[i]}${modules[i + 1]}</tr>`).join('')}</table>`;
  return { sujet: `${prenom ? prenom + ', b' : 'B'}ienvenue au Parlement JPV — informations importantes`, html: layout({ title: `Bienvenue au Parlement JPV${P ? `, ${P}` : ''}`, body:
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr><td style="background:#d62839;border-radius:8px;padding:18px 20px;">
      <div style="font-size:21px;line-height:1.25;font-weight:800;color:#ffffff;">Merci de lire attentivement l'ensemble de ce message.</div>
      <div style="font-size:15px;line-height:1.45;color:#ffe3e6;margin-top:6px;">Toutes les informations qu'il contient sont importantes pour ta participation au Parlement.</div></td></tr></table>` +
    `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Ton adhésion est confirmée : tu es désormais <strong>membre du Parlement JPV</strong>, l'instance de débat du lycée Jean-Pierre Vernant de Sèvres.</p>` +
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;">Le Parlement a une ambition simple : permettre à chaque élève d'apprendre à construire un argument, à le défendre en public et à écouter le point de vue opposé. Aucune expérience n'est requise ; chacun progresse à son rythme, séance après séance.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1f4b;border-radius:8px;border-bottom:4px solid #d62839;"><tr>
      <td colspan="3" style="padding:16px 20px 0;font-size:12px;font-weight:700;color:#ff8a95;">Le Parlement JPV en chiffres</td></tr><tr>
      ${chiffre('2', 'camps par débat,<br>tirés au sort')}${chiffre('4', 'rôles de prise<br>de parole')}${chiffre('22', 'distinctions<br>à obtenir', false)}</tr></table>` +
    rub('1', 'Rejoindre le groupe WhatsApp') +
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">C'est le canal d'information quotidien du Parlement : annonces des séances, sujets retenus, changements de dernière minute. <strong>L'adhésion au groupe est indispensable</strong> pour suivre la vie de l'instance.</p>` +
    `<a href="${WA}" style="display:inline-block;background:#25d366;color:#ffffff;font-weight:800;font-size:15px;padding:13px 24px;text-decoration:none;border-radius:6px;">Rejoindre le groupe WhatsApp</a>` +
    rub('2', 'Le déroulement d\'une séance') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${temps('Inscription', 'Depuis ton espace membre, tu indiques « Je viens ». Un tirage au sort t\'affecte à l\'un des deux camps, pour ou contre, indépendamment de ton opinion personnelle.')}
      ${temps('Préparation', 'Dans la salle de préparation de ton camp, vous proposez et votez les arguments, anticipez ceux du camp adverse et répartissez les quatre rôles : ouverture, argument, réfutation, conclusion.')}
      ${temps('Séance', 'Le débat se tient en présence des deux camps. La salle vote à l\'issue des échanges, puis les présents élisent le meilleur orateur de la séance.', true)}</table>` +
    rub('3', 'Ton espace membre') +
    grilleM +
    rub('4', 'Installer l\'application') +
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">L'application ouvre directement ton espace et t'adresse une notification à chaque nouvelle séance, la veille de la séance et à chaque vote.</p>` + installation +
    `<p style="margin:18px 0 0;">${button(`${SITE}/application`, 'Installer l\'application')}</p>` +
    rub('5', 'Ton certificat de membre') +
    `<p style="margin:0;font-size:15px;line-height:1.6;">Il est joint à ce message. Signé par toi et par la présidence, il comporte un QR code permettant à tout tiers d'en vérifier l'authenticité. Il peut être joint à un dossier Parcoursup, à un CV ou à une candidature, et reste téléchargeable à tout moment depuis ton espace.</p>` +
    rub('6', 'Les règles à connaître') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;border-radius:6px;"><tr><td style="padding:16px 18px;font-size:14.5px;line-height:1.6;color:#24304f;">
      <strong>Assiduité.</strong> Si tu t'es inscrit à une séance et que tu ne peux pas y assister, modifie ta réponse en « Je ne viens pas » avant son début : cela ne compte pas comme une absence. Au-delà de trois absences non signalées, le compte est suspendu.<br><br>
      <strong>Communications.</strong> Les messages du Parlement peuvent arriver dans le dossier Spam ou Promotions. Marque-les comme « non spam » pour ne manquer aucune information.<br><br>
      <strong>Questions.</strong> Il suffit de répondre à cet email : le bureau te répondra dans les meilleurs délais.</td></tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px;"><tr><td style="border-top:2px solid #0f1f4b;padding-top:16px;font-size:15px;line-height:1.6;">Au plaisir de t'accueillir en séance,<br><strong>Le bureau du Parlement JPV</strong><br><span style="font-size:13px;color:#5d6477;">Lycée Jean-Pierre Vernant · Sèvres</span></td></tr></table>` +
    `<p style="margin:22px 0 0;">${button(`${SITE}/compte`, 'Accéder à mon espace membre')}</p>` }) };
}

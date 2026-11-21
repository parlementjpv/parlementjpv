import { layout, button, esc, SITE } from '../_shared/lib.ts';

// Trois variantes de l'email de bienvenue (choix en cours).
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

/** A — La lettre du bureau : chaleureuse, racontée comme un accueil. */
export function varianteA(prenom: string) {
  const P = esc(prenom || '');
  return { sujet: `${prenom ? prenom + ', b' : 'B'}ienvenue au Parlement JPV 🇫🇷`, html: layout({ title: `Bienvenue parmi nous${P ? `, ${P}` : ''} !`, body:
    p(`Ça y est, tu fais partie du <strong>Parlement JPV</strong>, l'instance de débat du lycée Jean-Pierre Vernant. Toute l'équipe du bureau est très contente de t'accueillir.`) +
    p(`Ici, pas besoin d'être déjà un grand orateur : on vient pour apprendre à prendre la parole, à construire un argument, à écouter l'autre camp, et à le faire ensemble. Chacun progresse à son rythme, séance après séance.`) +
    `<div style="background:#e8f8ee;border:2px solid #25d366;border-radius:12px;padding:18px 20px;margin:22px 0;">
      <p style="margin:0 0 6px;font-size:17px;font-weight:800;">Avant tout : rejoins le groupe WhatsApp</p>
      <p style="margin:0 0 14px;font-size:15px;">C'est là qu'on se retrouve au quotidien : annonces des séances, sujets, changements de dernière minute, et les bonnes nouvelles. Clique, puis touche « Rejoindre le groupe ».</p>${vert('Rejoindre le groupe WhatsApp')}</div>` +
    h2('Comment se passe une séance ?') +
    p(`Le bureau publie une séance avec un sujet (par exemple « Faut-il rendre le vote obligatoire ? »). Tu réponds <strong>« Je viens »</strong> depuis ton espace, et un <strong>camp</strong> te est attribué par tirage au sort : pour ou contre. Peu importe ton avis personnel, c'est tout l'intérêt de l'exercice !`) +
    p(`Avant la séance, tu retrouves ton camp dans une <strong>salle de préparation</strong> en ligne : vous proposez vos arguments, votez les meilleurs et vous répartissez les prises de parole (ouverture, arguments, réfutation, conclusion). Le jour J, on débat, puis la salle vote et les présents élisent le <strong>meilleur orateur</strong>.`) +
    h2('Et entre les séances ?') +
    p(`Tu peux proposer des sujets (les <strong>motions</strong>), répondre aux <strong>sondages</strong> du bureau, t'inscrire aux <strong>sorties</strong> (Assemblée nationale, Sénat, tribunal…), participer au <strong>tournoi d'éloquence</strong>, et voter lors des <strong>élections du bureau</strong>. Ton <strong>profil d'orateur</strong> garde la trace de tout : séances, rôles tenus, badges gagnés.`) +
    h2('Installe l\'application (30 secondes)') +
    p(`Elle s'ouvre directement sur ton espace et t'envoie une notification à chaque nouvelle séance, la veille de la séance et à chaque vote. C'est gratuit, sans pub.`) + installation +
    `<p style="margin:20px 0;">${button(`${SITE}/application`, 'Installer l\'application')}</p>` +
    h2('Ton certificat de membre') +
    p(`Tu le trouveras en <strong>pièce jointe</strong> : un document officiel signé par toi et par la présidence, avec un QR code qui permet à n'importe qui de vérifier qu'il est authentique. Garde-le précieusement, il est utile pour Parcoursup, un CV ou une candidature. Il reste téléchargeable dans ton espace.`) +
    h2('Une seule règle à retenir') +
    p(`Si tu as répondu « Je viens » mais que tu ne peux finalement pas venir, change simplement ta réponse en « Je ne viens pas » avant le début : ça ne compte pas comme une absence. Au-delà de 3 absences non prévenues, le compte est suspendu, pour que les camps restent équilibrés.`) +
    `<div style="border-top:2px solid #e9ebf0;margin-top:28px;padding-top:18px;">` +
    p(`Une question, une idée, un doute ? Réponds simplement à cet email, ou passe par « Écrire au bureau » dans ton espace. On est là pour toi.`) +
    p(`À très vite en séance,<br><strong>Le bureau du Parlement JPV</strong>`) + `</div>` +
    `<p style="margin:18px 0 0;">${button(`${SITE}/compte`, 'Découvrir mon espace')}</p>` }) };
}

/** B — Le guide pas à pas : 5 étapes claires, chacune avec son bouton. */
export function varianteB(prenom: string) {
  const P = esc(prenom || '');
  const etape = (n: number, titre: string, texte: string, action: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:2px solid #e9ebf0;border-radius:12px;"><tr>
    <td style="vertical-align:top;padding:16px 0 16px 16px;width:44px;"><div style="width:36px;height:36px;line-height:36px;border-radius:50%;background:#0f1f4b;color:#fff;font-weight:800;text-align:center;font-size:17px;">${n}</div></td>
    <td style="vertical-align:top;padding:16px 18px 16px 12px;"><div style="font-weight:800;font-size:17px;margin:4px 0 6px;">${titre}</div><div style="font-size:15px;color:#3b4460;margin-bottom:10px;">${texte}</div>${action}</td></tr></table>`;
  const bouton = (u: string, t: string, c = '#d62839') => `<a href="${u}" style="display:inline-block;background:${c};color:#fff;font-weight:800;font-size:15px;padding:11px 20px;text-decoration:none;border-radius:8px;">${t}</a>`;
  return { sujet: `Bienvenue${prenom ? ' ' + prenom : ''} ! Tes 5 premières étapes au Parlement JPV`, html: layout({ title: `Bienvenue${P ? ` ${P}` : ''}, voici tes 5 premières étapes`, body:
    p(`Ton compte est actif : tu es officiellement membre du <strong>Parlement JPV</strong>, l'instance de débat du lycée Jean-Pierre Vernant. Pour bien démarrer, suis ces 5 étapes : ça prend moins de 5 minutes.`) +
    etape(1, 'Rejoins le groupe WhatsApp', 'Toutes les infos du quotidien y passent : séances, sujets, changements de dernière minute. Touche le bouton, puis « Rejoindre le groupe ».', bouton(WA, 'Rejoindre le groupe', '#25d366')) +
    etape(2, 'Installe l\'application et active les notifications', `Une alerte à chaque nouvelle séance, la veille de la séance et à chaque vote.<br><br><span style="font-size:14px;"><strong>iPhone :</strong> ouvre le lien dans Safari → Partager → « Sur l'écran d'accueil » → ouvre l'app → « Activer ».<br><strong>Android :</strong> ouvre le lien dans Chrome → « Installer l'application » → ouvre l'app → « Activer ».</span>`, bouton(`${SITE}/application`, 'Installer l\'application')) +
    etape(3, 'Réponds à la prochaine séance', 'Dans ton espace, touche « Je viens ». Un camp (pour ou contre) t\'est attribué par tirage au sort, et tu accèdes à la salle de préparation de ton camp pour construire vos arguments ensemble.', bouton(`${SITE}/compte`, 'Voir les prochaines séances')) +
    etape(4, 'Propose un sujet de débat', 'Une question te tient à cœur ? Propose-la comme motion. Les membres la soutiennent, et le bureau choisit les prochains sujets parmi les plus populaires.', bouton(`${SITE}/motions`, 'Proposer une motion')) +
    etape(5, 'Garde ton certificat de membre', 'Il est en pièce jointe : signé par toi et par la présidence, avec un QR code qui prouve son authenticité. Utile pour Parcoursup, un CV ou une candidature.', `<span style="font-size:14px;color:#5d6477;">📎 certificat en pièce jointe · aussi téléchargeable dans ton espace</span>`) +
    h2('Bon à savoir') +
    `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;">
      <li style="margin-bottom:6px;"><strong>Empêché ?</strong> Change ta réponse en « Je ne viens pas » avant la séance : ça ne compte pas comme une absence (3 absences non prévenues = compte suspendu).</li>
      <li style="margin-bottom:6px;"><strong>Les emails du Parlement</strong> arrivent parfois dans les spams : marque-les « non spam » pour ne rien rater.</li>
      <li style="margin-bottom:6px;"><strong>Aussi dans ton espace :</strong> sondages, sorties (Assemblée, Sénat…), tournoi d'éloquence, élections du bureau, profil d'orateur avec badges.</li>
      <li><strong>Une question ?</strong> Réponds à cet email, le bureau te répond.</li></ul>` +
    p(`À très vite en séance !<br><strong>Le bureau du Parlement JPV</strong>`) }) };
}

/** C — Le magazine : visuel, avec un grand mot d'accueil et des cartes. */
export function varianteC(prenom: string) {
  const P = esc(prenom || '');
  return { sujet: `${prenom ? prenom + ', t' : 'T'}a place au Parlement JPV est prête`, html: layout({ title: `${P ? `${P}, ta` : 'Ta'} place est prête`, body:
    `<p style="margin:0 0 18px;font-size:19px;line-height:1.45;font-weight:600;">« On ne naît pas orateur, on le devient, séance après séance. » Bienvenue au <strong>Parlement JPV</strong> : à partir d'aujourd'hui, la parole est aussi à toi.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1f4b;border-radius:12px;margin:0 0 22px;"><tr>
      <td style="padding:18px 20px;color:#fff;text-align:center;width:33%;"><div style="font-size:26px;font-weight:800;">2</div><div style="font-size:13px;color:#c9cfe0;">camps tirés au sort</div></td>
      <td style="padding:18px 20px;color:#fff;text-align:center;width:34%;"><div style="font-size:26px;font-weight:800;">4</div><div style="font-size:13px;color:#c9cfe0;">rôles à tenir</div></td>
      <td style="padding:18px 20px;color:#fff;text-align:center;width:33%;"><div style="font-size:26px;font-weight:800;">22</div><div style="font-size:13px;color:#c9cfe0;">badges à gagner</div></td></tr></table>` +
    `<div style="background:#e8f8ee;border:2px solid #25d366;border-radius:12px;padding:18px 20px;margin:0 0 8px;">
      <p style="margin:0 0 6px;font-size:17px;font-weight:800;">👋 Commence par le groupe WhatsApp</p>
      <p style="margin:0 0 14px;font-size:15px;">On y partage les séances, les sujets et les infos de dernière minute. Clique, puis « Rejoindre le groupe ».</p>${vert('Rejoindre le groupe')}</div>` +
    h2('Ta première séance, en 3 temps') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">
      <tr><td style="vertical-align:top;padding:0 12px 12px 0;width:110px;font-weight:800;color:#d62839;">Avant</td><td style="padding:0 0 12px;">Tu réponds « Je viens » dans ton espace. Le tirage au sort te place dans un camp, pour ou contre.</td></tr>
      <tr><td style="vertical-align:top;padding:0 12px 12px 0;font-weight:800;color:#d62839;">Préparation</td><td style="padding:0 0 12px;">Dans la salle de ton camp, vous proposez et votez vos arguments, anticipez ceux de l'autre camp et vous répartissez les rôles : ouverture, argument, réfutation, conclusion.</td></tr>
      <tr><td style="vertical-align:top;padding:0 12px 0 0;font-weight:800;color:#d62839;">Le jour J</td><td>On débat, la salle vote, et les présents élisent le meilleur orateur, qui gagne un titre sur son profil.</td></tr></table>` +
    h2('Tout ce qui t\'attend dans ton espace') +
    grille([
      carte('Motions', 'Propose les sujets que tu veux débattre et soutiens ceux des autres.', `${SITE}/motions`, 'Proposer'),
      carte('Tournoi d\'éloquence', 'Affronte les autres orateurs en duels, jusqu\'à la finale.', `${SITE}/tournoi`, 'Découvrir'),
      carte('Sorties', 'Assemblée nationale, Sénat, tribunal : inscris-toi aux visites.', `${SITE}/sorties`, 'Voir les sorties'),
      carte('Profil d\'orateur', 'Tes séances, tes rôles, tes 22 badges à débloquer.', `${SITE}/profil`, 'Mon profil'),
      carte('Sondages', 'Donne ton avis au bureau en un clic, anonymement.', `${SITE}/sondages`, 'Répondre'),
      carte('Écrire au bureau', 'Contacte un membre du bureau ou dépose une idée anonyme.', `${SITE}/ecrire-au-bureau`, 'Écrire'),
    ]) +
    h2('📱 Installe l\'application') +
    p(`Pour recevoir une alerte à chaque séance, la veille, et à chaque vote.`) + installation +
    `<p style="margin:18px 0;">${button(`${SITE}/application`, 'Installer l\'application')}</p>` +
    h2('📎 Ton certificat de membre') +
    p(`En pièce jointe : signé par toi et par la présidence, authentifiable par QR code. Parfait pour Parcoursup ou un CV.`) +
    petit(`Petit rappel : si tu ne peux pas venir à une séance où tu t'es inscrit, change ta réponse avant le début, ça ne compte pas comme une absence. Et si nos emails arrivent dans tes spams, marque-les « non spam ».`) +
    p(`Bienvenue dans l'hémicycle,<br><strong>Le bureau du Parlement JPV</strong>`) }) };
}

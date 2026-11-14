# Registre des activités de traitement — Parlement JPV

*Article 30 du RGPD. Document interne, à tenir à jour par le bureau.*

**Dernière mise à jour :** 14 novembre 2026

## Identification

| | |
|---|---|
| **Organisme** | Parlement JPV, instance de débat créée par des élèves du lycée Jean-Pierre Vernant (Sèvres) |
| **Responsable de traitement** | Bureau du Parlement JPV — parlementjpv@gmail.com |
| **Site concerné** | https://parlementjpv.github.io/parlementjpv/ |

## Sous-traitants

| Prestataire | Rôle | Localisation des données | Garanties |
|---|---|---|---|
| Supabase, Inc. | Base de données, comptes, fonctions serveur | Union européenne (Stockholm, Suède) | Contrat de traitement (DPA) Supabase, clauses contractuelles types |
| Google LLC (Gmail) | Envoi des emails depuis parlementjpv@gmail.com | États-Unis / UE | Data Privacy Framework UE–États-Unis, clauses contractuelles types |
| GitHub, Inc. | Hébergement des pages statiques (aucune donnée de formulaire) | États-Unis | Data Privacy Framework UE–États-Unis |

## Traitements

### 1. Membres de l'instance (comptes et adhésions)
- **Finalité :** gérer l'adhésion à l'instance, l'espace membre, les contacts du bureau avec les membres.
- **Personnes concernées :** élèves et personnels du lycée.
- **Données :** prénom, nom, classe, email, téléphone (facultatif), centres d'intérêt, mot de passe haché, rôle (membre, bureau, admin), statut de bannissement, choix de recevoir les annonces.
- **Base légale :** consentement (art. 6.1.a) ; accord parental pour les moins de 15 ans (art. 45 loi Informatique et Libertés), confirmé par case à cocher.
- **Destinataires :** bureau du Parlement JPV.
- **Durée :** jusqu'à suppression du compte ; purge automatique après 3 ans sans connexion, 30 jours si le compte n'est jamais activé ; adhésions sans compte jusqu'à la fin de l'année scolaire suivante.

### 2. Séances et événements
- **Finalité :** organiser les séances, répartir les participants en camps, confirmer la présence, prévenir en cas d'annulation, annoncer les nouvelles séances.
- **Données :** prénom, nom, classe, email, téléphone (facultatif), réponse (vient / ne vient pas), camp tiré au sort, jeton d'accès personnel à la salle de préparation.
- **Base légale :** consentement (réponse) ; intérêt légitime de l'instance pour les annonces, avec opposition possible à tout moment (lien dans chaque email et réglage dans « Mon espace »).
- **Destinataires :** bureau.
- **Durée :** 12 mois après la séance.

### 3. Salles de préparation des camps
- **Finalité :** permettre aux membres d'un même camp de préparer ensemble leurs arguments.
- **Données :** prénom et initiale du nom, classe, arguments, sources, objections, messages, votes, rôles de prise de parole.
- **Base légale :** consentement.
- **Destinataires :** membres du même camp ; bureau en lecture seule.
- **Durée :** 12 mois après la séance.

### 4. Candidatures au bureau
- **Finalité :** examiner les candidatures et informer les candidats de la décision.
- **Données :** identité, classe, email, poste visé, motivation, expérience, disponibilités, décision et note du bureau.
- **Base légale :** consentement.
- **Destinataires :** bureau.
- **Durée :** 1 an après la décision.

### 5. Messages du bureau aux membres
- **Finalité :** écrire par email à des membres choisis.
- **Données :** destinataires, objet, texte, nom de l'expéditeur au sein du bureau (non visible des destinataires).
- **Base légale :** intérêt légitime.
- **Durée :** historique conservé 1 an.

### 6. Newsletter
- **Finalité :** envoyer la lettre mensuelle d'information.
- **Données :** email, date et adresse IP de confirmation.
- **Base légale :** consentement, confirmé par double opt-in.
- **Durée :** jusqu'à la désinscription (suppression 30 jours après) ; 30 jours si l'inscription n'est jamais confirmée.

### 7. Formulaire de contact
- **Finalité :** répondre aux demandes.
- **Données :** nom, email, message.
- **Base légale :** intérêt légitime.
- **Durée :** 1 an.

### 8. Appel en séance et profil d'orateur
- **Finalité :** suivre la présence aux séances, appliquer la règle d'assiduité (avertissement par email à la dernière absence tolérée, suspension automatique du compte au-delà du seuil fixé dans les réglages, 3 par défaut), calculer le profil d'orateur et ses badges.
- **Données :** statut (présent, absent, excusé) par séance, camp, rôles de prise de parole, nombre d'arguments retenus.
- **Base légale :** intérêt légitime de l'instance ; règle annoncée dans la politique de confidentialité et dans l'email d'avertissement. Un admin peut réactiver un compte suspendu (le compteur d'absences repart alors de zéro).
- **Destinataires :** bureau ; l'intéressé ; les autres membres voient seulement séances, rôles et badges (jamais les absences).
- **Durée :** tant que la personne est membre ; 12 mois pour les participants sans compte.

### 9. Banque de motions
- **Finalité :** proposer et classer les sujets de débat.
- **Données :** texte, auteur (prénom et initiale), votes de soutien.
- **Base légale :** consentement.
- **Durée :** tant que le bureau conserve la motion.

### 10. Élections du bureau
- **Finalité :** élire les membres du bureau à bulletin secret.
- **Données :** liste des électeurs ayant voté (pour empêcher le double vote) ; les choix ne sont enregistrés que sous forme de compteurs, sans aucun lien avec l'électeur — aucun bulletin individuel n'existe.
- **Base légale :** intérêt légitime.
- **Durée :** liste des votants supprimée 30 jours après la clôture ; totaux conservés.

### 11. Espace interne du bureau
- **Finalité :** organiser le travail du bureau (tâches, discussion, notes de réunion).
- **Données :** contenu rédigé par les membres du bureau, auteur.
- **Durée :** messages 1 an ; tâches et notes jusqu'à suppression.

## Mesures de sécurité
- HTTPS sur tout le site ; mots de passe hachés (bcrypt) par Supabase Auth.
- Règles d'accès en base (Row Level Security) : chaque membre ne voit que ses propres données ; listes et réponses réservées au bureau ; actions sensibles (bannir, supprimer un compte) réservées à l'administrateur.
- Salles de préparation accessibles uniquement par jeton personnel aléatoire ; isolement vérifié entre camps.
- Purge automatique quotidienne (tâches `purge-donnees` à 3 h 17 et `purge-complements` à 3 h 27) appliquant les durées ci-dessus.
- Aucun cookie publicitaire, aucun outil de mesure d'audience, police de caractères hébergée sur le site.

## Gestion des incidents
En cas de fuite ou d'accès non autorisé aux données : le bureau notifie la CNIL dans les 72 heures si nécessaire (art. 33 RGPD) et prévient les personnes concernées si le risque est élevé (art. 34).

## À faire par le bureau
- [ ] Désigner nommément le directeur de la publication (président, au moins 16 ans) et le professeur référent codirecteur.
- [ ] Rappeler aux membres du bureau leur obligation de confidentialité sur les données des membres.
- [ ] Mettre à jour ce registre à chaque nouvelle fonctionnalité qui collecte des données.

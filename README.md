# Parlement JPV — site v2

Site du Parlement JPV (lycée Jean-Pierre Vernant, Sèvres) : vitrine, agenda, actualités, rapports, **inscription sécurisée**, **newsletter double opt-in**, **candidatures en ligne**, **espace membre** et **espace bureau**.

Stack 100 % gratuite : [Astro](https://astro.build) (site statique) · [Supabase](https://supabase.com) (auth + base Postgres, UE) · [Resend](https://resend.com) (emails) · GitHub Pages (hébergement) + Supabase Edge Functions (serveur) · Cloudflare Turnstile (anti-robots, facultatif).

```
src/pages/        pages du site (.astro) — une par URL
src/components/   Header, Footer, NewsletterForm, EventList
src/content/posts/  actualités en Markdown (1 fichier = 1 article)
src/data/         events.json (agenda + stats), reports.json, team.json
supabase/functions/ API serveur (Edge Functions Deno) : newsletter, contact, candidature, rôles, suppression de compte
.github/workflows/  déploiement automatique sur GitHub Pages à chaque push sur main
supabase/schema.sql tables + règles de sécurité (RLS)
```

## Mise en place (≈ 30 min, une seule fois)

### 1. Supabase (base + authentification)
1. Crée un projet sur supabase.com (région **Frankfurt (eu-central-1)** pour rester en UE).
2. **SQL Editor → New query** : colle tout `supabase/schema.sql` → *Run*.
3. **Authentication → Providers → Email** : laisse *Confirm email* activé.
4. **Authentication → URL Configuration** : Site URL = l'URL du site ; Redirect URLs = `https://TON-SITE/*`.
5. **Authentication → Email Templates** : traduis en français si tu veux (objet + texte). Pour que ces emails partent via Resend (et pas via le SMTP limité de Supabase), **Project Settings → Auth → SMTP** : host `smtp.resend.com`, port 465, user `resend`, password = ta clé API Resend, sender = `noreply@ton-domaine`.
6. **Project Settings → API** : note `Project URL`, `anon public` et `service_role` (secret !).

### 2. Resend (envoi d'emails)
1. Crée un compte, ajoute ton domaine (ou utilise `onboarding@resend.dev` pour tester : envoi uniquement vers ton propre email).
2. **API Keys → Create** : note la clé `re_…`.
3. Gratuit : 3 000 emails / mois, 100 / jour.

### 3. Cloudflare Turnstile (facultatif, recommandé)
Dashboard Cloudflare → Turnstile → Add site → note *Site key* et *Secret key*. Sans ça, les formulaires fonctionnent mais sans protection anti-robots.

### 4. Fonctions serveur (Supabase Edge Functions)
```bash
npx supabase login                      # ou SUPABASE_ACCESS_TOKEN=sbp_...
npx supabase link --project-ref bisnyrbrllipxstimpkk
npx supabase secrets set RESEND_API_KEY=re_... BUREAU_EMAIL=parlementjpv@gmail.com SITE_URL=https://parlementjpv.github.io "MAIL_FROM=Parlement JPV <onboarding@resend.dev>"
npx supabase functions deploy           # déploie les 8 fonctions
```

### 5. GitHub Pages (hébergement)
1. Repo **Settings → Pages → Source : GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** : `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_ANON_KEY` (valeurs dans Supabase → Project Settings → API Keys).
3. Chaque push sur `main` redéploie le site (workflow `deploy.yml`). Domaine perso : Settings → Pages → Custom domain.

### 6. Premier admin
Crée ton compte sur le site (`/inscription`), confirme l'email, puis dans Supabase **SQL Editor** :
```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'ton@email.fr');
```
Tu as maintenant accès à `/bureau`, où tu peux donner le rôle *bureau* aux autres membres.

## Au quotidien

| Je veux…                            | Je fais…                                                                                  |
|-------------------------------------|-------------------------------------------------------------------------------------------|
| Publier une actualité               | Ajouter un fichier `src/content/posts/AAAA-MM-JJ-titre.md` (voir les exemples) et pousser |
| Ajouter une séance à l'agenda       | Éditer `src/data/events.json`                                                             |
| Ajouter un rapport PDF              | Déposer le PDF dans `public/assets/docs/` et l'ajouter à `src/data/reports.json`          |
| Mettre à jour le bureau             | `src/data/team.json` (+ photo dans `public/assets/img/`)                                  |
| Envoyer une newsletter              | `/bureau` → onglet Newsletter → rédiger → *M'envoyer un test* → *Envoyer*                 |
| Traiter les candidatures            | `/bureau` → onglet Candidatures (statut + note visible par le candidat)                    |
| Retirer le bandeau « en pause »     | Supprimer le bloc `.notice` dans `src/layouts/Base.astro`                                  |

## Développement local
```bash
npm install
cp .env.example .env   # puis remplis les valeurs
npm run dev            # http://localhost:4321  (fonctions serveur en local : `npx supabase functions serve`)
```

## Sécurité — ce qui a changé par rapport à la v1
- Plus aucun mot de passe dans le code (la v1 avait les identifiants du bureau en clair dans `Espace-bureau.html`, lisibles par tous).
- Mots de passe hachés par Supabase Auth, sessions JWT, confirmation d'email, réinitialisation sécurisée.
- Row Level Security : chaque membre ne lit que ses données ; candidatures, abonnés et messages réservés au bureau ; changement de rôle réservé aux admins et vérifié côté serveur.
- Clé `service_role` et clé Resend uniquement dans les secrets des Edge Functions, jamais dans le code.
- Newsletter en double opt-in, lien de désinscription dans chaque email + en-tête `List-Unsubscribe` (RGPD / anti-spam).
- Plus de Google Analytics ni de cookies tiers → plus de bannière cookies nécessaire.

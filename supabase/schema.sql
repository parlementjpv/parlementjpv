-- =====================================================================
-- PARLEMENT JPV — Schéma Supabase (à coller dans SQL Editor, puis Run)
-- Sécurité : Row Level Security activée partout. La clé "anon" publique
-- ne permet jamais de lire les données d'un autre utilisateur.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Rôles ----------
do $$ begin
  create type public.user_role as enum ('membre', 'bureau', 'admin');
exception when duplicate_object then null; end $$;

-- ---------- Profils (1 ligne par compte auth) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  prenom      text not null default '',
  nom         text not null default '',
  classe      text,
  role        public.user_role not null default 'membre',
  newsletter  boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Création automatique du profil à l'inscription (prend prenom/nom/classe des metadata)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, prenom, nom, classe)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'prenom', ''),
    coalesce(new.raw_user_meta_data->>'nom', ''),
    nullif(new.raw_user_meta_data->>'classe', '')
  ) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper : l'utilisateur courant est-il du bureau ?
create or replace function public.is_bureau()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('bureau', 'admin'));
$$;

-- Policies profils
drop policy if exists "profil: lecture soi-même" on public.profiles;
create policy "profil: lecture soi-même" on public.profiles for select using (auth.uid() = id or public.is_bureau());
drop policy if exists "profil: modification soi-même" on public.profiles;
create policy "profil: modification soi-même" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.profiles where id = auth.uid())); -- on ne peut pas s'auto-promouvoir
drop policy if exists "profil: suppression soi-même" on public.profiles;
create policy "profil: suppression soi-même" on public.profiles for delete using (auth.uid() = id);

-- ---------- Newsletter ----------
create table if not exists public.newsletter_subscribers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  confirmed     boolean not null default false,
  token         text not null default encode(gen_random_bytes(24), 'hex'),
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  confirm_ip    text,
  unsubscribed_at timestamptz
);
alter table public.newsletter_subscribers enable row level security;
-- Aucune policy "anon" : seules les fonctions serveur (service role) y touchent.
drop policy if exists "newsletter: bureau lit" on public.newsletter_subscribers;
create policy "newsletter: bureau lit" on public.newsletter_subscribers for select using (public.is_bureau());

create table if not exists public.newsletters (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  body_html   text not null,
  body_text   text,
  author_id   uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  recipients  int
);
alter table public.newsletters enable row level security;
drop policy if exists "newsletters: archive publique" on public.newsletters;
create policy "newsletters: archive publique" on public.newsletters for select using (sent_at is not null or public.is_bureau());
drop policy if exists "newsletters: bureau écrit" on public.newsletters;
create policy "newsletters: bureau écrit" on public.newsletters for insert with check (public.is_bureau());
drop policy if exists "newsletters: bureau modifie" on public.newsletters;
create policy "newsletters: bureau modifie" on public.newsletters for update using (public.is_bureau());
drop policy if exists "newsletters: bureau supprime" on public.newsletters;
create policy "newsletters: bureau supprime" on public.newsletters for delete using (public.is_bureau() and sent_at is null);

-- ---------- Candidatures ----------
do $$ begin
  create type public.candidature_statut as enum ('nouvelle', 'en_cours', 'acceptee', 'refusee');
exception when duplicate_object then null; end $$;

create table if not exists public.candidatures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  type        text not null default 'membre',          -- 'membre' | 'mun' | 'bureau'
  prenom      text not null,
  nom         text not null,
  email       text not null,
  classe      text not null,
  motivation  text not null,
  experience  text,
  disponibilites text,
  statut      public.candidature_statut not null default 'nouvelle',
  note_bureau text,
  created_at  timestamptz not null default now()
);
alter table public.candidatures enable row level security;
drop policy if exists "candidature: dépôt" on public.candidatures;
create policy "candidature: dépôt" on public.candidatures for insert with check (auth.uid() = user_id);
drop policy if exists "candidature: lecture" on public.candidatures;
create policy "candidature: lecture" on public.candidatures for select using (auth.uid() = user_id or public.is_bureau());
drop policy if exists "candidature: bureau modifie" on public.candidatures;
create policy "candidature: bureau modifie" on public.candidatures for update using (public.is_bureau());

-- ---------- Inscriptions aux séances ----------
create table if not exists public.event_registrations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  event_key   text not null,                 -- ex: "2027-09-15|Reprise des séances"
  created_at  timestamptz not null default now(),
  unique (user_id, event_key)
);
alter table public.event_registrations enable row level security;
drop policy if exists "inscriptions: soi-même" on public.event_registrations;
create policy "inscriptions: soi-même" on public.event_registrations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "inscriptions: bureau lit" on public.event_registrations;
create policy "inscriptions: bureau lit" on public.event_registrations for select using (public.is_bureau());

-- ---------- Messages de contact ----------
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  email       text not null,
  sujet       text,
  message     text not null,
  created_at  timestamptz not null default now(),
  traite      boolean not null default false
);
alter table public.contact_messages enable row level security;
drop policy if exists "contact: bureau lit" on public.contact_messages;
create policy "contact: bureau lit" on public.contact_messages for select using (public.is_bureau());
drop policy if exists "contact: bureau modifie" on public.contact_messages;
create policy "contact: bureau modifie" on public.contact_messages for update using (public.is_bureau());

-- ---------- Vue "nombre d'abonnés" (sans emails) pour le tableau de bord bureau ----------
create or replace view public.newsletter_stats as
  select count(*) filter (where confirmed and unsubscribed_at is null) as confirmes,
         count(*) filter (where not confirmed) as en_attente,
         count(*) filter (where unsubscribed_at is not null) as desinscrits
  from public.newsletter_subscribers;
alter view public.newsletter_stats set (security_invoker = true);
revoke all on public.newsletter_stats from anon;

-- =====================================================================
-- APRÈS AVOIR CRÉÉ TON COMPTE SUR LE SITE, promeus-toi admin :
--   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'ton@email.fr');
-- =====================================================================
-- 002 — Inscriptions aux événements (avec ou sans compte) + poste visé pour les candidatures au bureau

create table if not exists public.event_signups (
  id          uuid primary key default gen_random_uuid(),
  event_key   text not null check (char_length(event_key) between 3 and 200),   -- "AAAA-MM-JJ|Titre"
  prenom      text not null check (char_length(prenom) between 1 and 80),
  nom         text not null check (char_length(nom) between 1 and 80),
  classe      text not null check (char_length(classe) between 1 and 40),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and char_length(email) < 200),
  user_id     uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists event_signups_unique on public.event_signups (event_key, lower(email));
alter table public.event_signups enable row level security;

drop policy if exists "evenement: inscription publique" on public.event_signups;
create policy "evenement: inscription publique" on public.event_signups for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
drop policy if exists "evenement: lecture" on public.event_signups;
create policy "evenement: lecture" on public.event_signups for select using (auth.uid() = user_id or public.is_bureau());
drop policy if exists "evenement: désinscription" on public.event_signups;
create policy "evenement: désinscription" on public.event_signups for delete using (auth.uid() = user_id or public.is_bureau());

-- Nombre d'inscrits par événement, lisible par tous (sans aucune donnée personnelle)
create or replace function public.event_counts()
returns table(event_key text, inscrits bigint) language sql stable security definer set search_path = public as $$
  select event_key, count(*) from public.event_signups group by event_key;
$$;
grant execute on function public.event_counts() to anon, authenticated;

-- L'ancienne table d'inscriptions (comptes seulement) est remplacée
drop table if exists public.event_registrations;

-- Candidatures : poste visé pour l'élection du bureau
alter table public.candidatures add column if not exists poste text;
-- 003 — « Rejoindre l'instance » : adhésion simple, sans compte obligatoire

create table if not exists public.adhesions (
  id          uuid primary key default gen_random_uuid(),
  prenom      text not null check (char_length(prenom) between 1 and 80),
  nom         text not null check (char_length(nom) between 1 and 80),
  classe      text not null check (char_length(classe) between 1 and 40),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and char_length(email) < 200),
  interets    text[] not null default '{}' check (cardinality(interets) <= 10),
  message     text check (char_length(message) <= 1000),
  user_id     uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists adhesions_email_unique on public.adhesions (lower(email));
alter table public.adhesions enable row level security;

drop policy if exists "adhesion: publique" on public.adhesions;
create policy "adhesion: publique" on public.adhesions for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
drop policy if exists "adhesion: lecture" on public.adhesions;
create policy "adhesion: lecture" on public.adhesions for select using (auth.uid() = user_id or public.is_bureau());
drop policy if exists "adhesion: suppression" on public.adhesions;
create policy "adhesion: suppression" on public.adhesions for delete using (auth.uid() = user_id or public.is_bureau());

-- Nombre de membres, lisible par tous (aucune donnée personnelle)
create or replace function public.adhesions_count()
returns bigint language sql stable security definer set search_path = public as $$ select count(*) from public.adhesions; $$;
grant execute on function public.adhesions_count() to anon, authenticated;
-- 004 — Événements créés par le bureau + réponses « je viens / je ne viens pas »

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 140),
  type        text not null default 'Débat' check (type in ('Débat','Conférence','Atelier','Concours','Visite','Séance','Événement')),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  location    text not null default 'Salle Samuel Paty' check (char_length(location) <= 140),
  description text check (char_length(description) <= 2000),
  capacity    int check (capacity is null or capacity > 0),
  published   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists events_starts_at on public.events (starts_at);
alter table public.events enable row level security;

drop policy if exists "events: lecture publique" on public.events;
create policy "events: lecture publique" on public.events for select using (published or public.is_bureau());
drop policy if exists "events: bureau crée" on public.events;
create policy "events: bureau crée" on public.events for insert with check (public.is_bureau());
drop policy if exists "events: bureau modifie" on public.events;
create policy "events: bureau modifie" on public.events for update using (public.is_bureau());
drop policy if exists "events: bureau supprime" on public.events;
create policy "events: bureau supprime" on public.events for delete using (public.is_bureau());

-- Réponses : « oui » (je viens) ou « non » (je ne viens pas). event_key = id de l'événement.
alter table public.event_signups add column if not exists reponse text not null default 'oui' check (reponse in ('oui','non'));
drop policy if exists "evenement: changer sa réponse" on public.event_signups;
create policy "evenement: changer sa réponse" on public.event_signups for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Suppression d'un événement => suppression de ses réponses
create or replace function public.events_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin delete from public.event_signups where event_key = old.id::text; return old; end $$;
drop trigger if exists events_cleanup on public.events;
create trigger events_cleanup after delete on public.events for each row execute procedure public.events_cleanup();

-- Compteurs publics (sans données personnelles)
drop function if exists public.event_counts();
create function public.event_counts()
returns table(event_key text, oui bigint, non bigint) language sql stable security definer set search_path = public as $$
  select event_key, count(*) filter (where reponse = 'oui'), count(*) filter (where reponse = 'non')
  from public.event_signups group by event_key;
$$;
grant execute on function public.event_counts() to anon, authenticated;
-- 005 — Téléphone, compte = membre de l'instance, bannissement, archives des candidatures

-- Téléphone (format souple : chiffres, espaces, + . - ( ), 8 à 20 caractères)
alter table public.profiles       add column if not exists telephone text check (telephone is null or telephone ~ '^[+0-9 .()-]{8,20}$');
alter table public.adhesions      add column if not exists telephone text check (telephone is null or telephone ~ '^[+0-9 .()-]{8,20}$');
alter table public.event_signups  add column if not exists telephone text check (telephone is null or telephone ~ '^[+0-9 .()-]{8,20}$');

-- Bannissement (le blocage réel est fait par Supabase Auth ; cette colonne sert à l'affichage)
alter table public.profiles add column if not exists banni boolean not null default false;

-- Date de décision (pour trier les archives)
alter table public.candidatures add column if not exists decided_at timestamptz;

-- À la création d'un compte : profil + adhésion automatique à l'instance
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  tel text := nullif(m->>'telephone', '');
begin
  if tel is not null and tel !~ '^[+0-9 .()-]{8,20}$' then tel := null; end if;
  insert into public.profiles (id, prenom, nom, classe, telephone)
  values (new.id, coalesce(m->>'prenom', ''), coalesce(m->>'nom', ''), nullif(m->>'classe', ''), tel)
  on conflict (id) do nothing;
  insert into public.adhesions (prenom, nom, classe, email, telephone, user_id, interets)
  values (
    coalesce(nullif(m->>'prenom', ''), '?'), coalesce(nullif(m->>'nom', ''), '?'), coalesce(nullif(m->>'classe', ''), '?'),
    lower(new.email), tel, new.id,
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(m->'interets') = 'array' then m->'interets' else '[]'::jsonb end)), '{}')
  )
  on conflict ((lower(email))) do update set user_id = excluded.user_id, telephone = coalesce(public.adhesions.telephone, excluded.telephone);
  return new;
end $$;

-- Rattrapage : les comptes existants deviennent membres
insert into public.adhesions (prenom, nom, classe, email, telephone, user_id)
select coalesce(nullif(p.prenom,''),'?'), coalesce(nullif(p.nom,''),'?'), coalesce(nullif(p.classe,''),'?'), lower(u.email), p.telephone, u.id
from auth.users u join public.profiles p on p.id = u.id
on conflict ((lower(email))) do update set user_id = excluded.user_id;

-- Un membre peut mettre à jour sa propre fiche d'adhésion (téléphone, classe…)
drop policy if exists "adhesion: mise à jour" on public.adhesions;
create policy "adhesion: mise à jour" on public.adhesions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Un utilisateur ne peut pas se « débannir » lui-même via son profil
drop policy if exists "profil: modification soi-même" on public.profiles;
create policy "profil: modification soi-même" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id
    and role  = (select role  from public.profiles where id = auth.uid())
    and banni = (select banni from public.profiles where id = auth.uid()));
-- 006 — Historique des messages envoyés par le bureau aux membres
create table if not exists public.member_messages (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null check (char_length(subject) between 1 and 200),
  body        text not null check (char_length(body) between 1 and 10000),
  recipients  text[] not null default '{}',
  sent_count  int not null default 0,
  sender_id   uuid references public.profiles(id) on delete set null,
  sender_name text,
  created_at  timestamptz not null default now()
);
alter table public.member_messages enable row level security;
drop policy if exists "messages membres: bureau lit" on public.member_messages;
create policy "messages membres: bureau lit" on public.member_messages for select using (public.is_bureau());
-- écriture uniquement par la fonction serveur (service role)
-- 007 — Camps de débat : 2 à 4 camps par événement, attribution aléatoire et équilibrée par le serveur

alter table public.events add column if not exists camps text[] not null default '{}'
  check (cardinality(camps) = 0 or cardinality(camps) between 2 and 4);
alter table public.event_signups add column if not exists camp text;

-- Tirage : parmi les camps les moins remplis de l'événement, un au hasard
create or replace function public.tirer_camp(p_event text)
returns text language sql volatile security definer set search_path = public as $$
  with c as (
    select unnest(e.camps) as camp from public.events e where e.id::text = p_event
  ), n as (
    select c.camp, (select count(*) from public.event_signups s where s.event_key = p_event and s.reponse = 'oui' and s.camp = c.camp) as nb from c
  )
  select camp from n where nb = (select min(nb) from n) order by random() limit 1;
$$;

-- Le camp est toujours fixé par le serveur : impossible de le choisir soi-même
create or replace function public.event_signups_camp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reponse = 'oui' then
    if tg_op = 'INSERT' or old.reponse is distinct from 'oui' or new.camp is distinct from old.camp then
      new.camp := public.tirer_camp(new.event_key);
    end if;
  else
    new.camp := null;
  end if;
  return new;
end $$;
drop trigger if exists event_signups_camp on public.event_signups;
create trigger event_signups_camp before insert or update on public.event_signups
  for each row execute procedure public.event_signups_camp();

-- Réponse à un événement (avec ou sans compte) : renvoie le camp attribué
create or replace function public.repondre_evenement(
  p_event text, p_reponse text, p_prenom text, p_nom text, p_classe text, p_email text, p_telephone text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.event_signups;
begin
  if p_reponse not in ('oui', 'non') then raise exception 'reponse invalide'; end if;
  if not exists (select 1 from public.events where id::text = p_event and published) then raise exception 'evenement introuvable'; end if;
  if uid is not null then
    select * into r from public.event_signups where event_key = p_event and user_id = uid;
    if found then
      update public.event_signups set reponse = p_reponse where id = r.id returning * into r;
      return json_build_object('statut', 'modifie', 'reponse', r.reponse, 'camp', r.camp);
    end if;
  end if;
  begin
    insert into public.event_signups (event_key, reponse, prenom, nom, classe, email, telephone, user_id)
    values (p_event, p_reponse, trim(p_prenom), trim(p_nom), trim(p_classe), lower(trim(p_email)), nullif(trim(p_telephone), ''), uid)
    returning * into r;
  exception when unique_violation then
    return json_build_object('statut', 'deja');
  end;
  return json_build_object('statut', 'ok', 'reponse', r.reponse, 'camp', r.camp);
end $$;
grant execute on function public.repondre_evenement(text, text, text, text, text, text, text) to anon, authenticated;

-- Compteurs publics, avec le nombre de participants par camp (sans données personnelles)
drop function if exists public.event_counts();
create function public.event_counts()
returns table(event_key text, oui bigint, non bigint, par_camp json) language sql stable security definer set search_path = public as $$
  select s.event_key,
         count(*) filter (where s.reponse = 'oui'),
         count(*) filter (where s.reponse = 'non'),
         coalesce((select json_object_agg(x.camp, x.nb) from (select camp, count(*) nb from public.event_signups where event_key = s.event_key and reponse = 'oui' and camp is not null group by camp) x), '{}'::json)
  from public.event_signups s group by s.event_key;
$$;
grant execute on function public.event_counts() to anon, authenticated;
-- 008 — Salles de préparation par camp
-- Accès par jeton personnel (lien privé envoyé par email) : fonctionne avec ou sans compte.
-- Aucune table n'est lisible directement : tout passe par des fonctions qui vérifient le jeton et le camp.

alter table public.event_signups add column if not exists jeton uuid not null default gen_random_uuid();
create unique index if not exists event_signups_jeton on public.event_signups (jeton);

create table if not exists public.camp_posts (
  id          uuid primary key default gen_random_uuid(),
  event_key   text not null,
  camp        text not null,
  kind        text not null check (kind in ('argument', 'objection', 'message')),
  auteur      uuid references public.event_signups(id) on delete set null,
  auteur_nom  text not null,
  titre       text check (char_length(titre) <= 200),
  contenu     text not null check (char_length(contenu) between 1 and 3000),
  source      text check (char_length(source) <= 500),
  reponse     text check (char_length(reponse) <= 3000),
  retenu      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists camp_posts_salle on public.camp_posts (event_key, camp, kind, created_at);

create table if not exists public.camp_votes (
  post_id   uuid not null references public.camp_posts(id) on delete cascade,
  signup_id uuid not null references public.event_signups(id) on delete cascade,
  primary key (post_id, signup_id)
);

create table if not exists public.camp_roles (
  event_key text not null,
  camp      text not null,
  role      text not null,
  signup_id uuid not null references public.event_signups(id) on delete cascade,
  primary key (event_key, camp, role)
);

alter table public.camp_posts enable row level security;
alter table public.camp_votes enable row level security;
alter table public.camp_roles enable row level security;
drop policy if exists "salles: bureau lit" on public.camp_posts;
create policy "salles: bureau lit" on public.camp_posts for select using (public.is_bureau());
drop policy if exists "salles: bureau supprime" on public.camp_posts;
create policy "salles: bureau supprime" on public.camp_posts for delete using (public.is_bureau());

-- Suppression d'un événement => suppression de ses salles
create or replace function public.events_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.camp_roles where event_key = old.id::text;
  delete from public.camp_posts where event_key = old.id::text;
  delete from public.event_signups where event_key = old.id::text;
  return old;
end $$;

-- Rôles de prise de parole proposés dans chaque salle
create or replace function public.salle_roles_liste() returns text[] language sql immutable as $$
  select array['Ouverture', 'Argument 1', 'Argument 2', 'Argument 3', 'Réfutation', 'Conclusion'];
$$;

-- Participant correspondant à un jeton (doit venir et avoir un camp)
create or replace function public.salle_moi(p_jeton uuid)
returns public.event_signups language plpgsql stable security definer set search_path = public as $$
declare s public.event_signups;
begin
  select * into s from public.event_signups where jeton = p_jeton and reponse = 'oui' and camp is not null;
  if not found then raise exception 'acces_refuse'; end if;
  return s;
end $$;

-- État complet d'une salle (vue participant ou bureau)
create or replace function public.salle_contenu(p_event text, p_camp text, p_moi uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'evenement', (select json_build_object('id', e.id, 'titre', e.title, 'type', e.type, 'debut', e.starts_at, 'fin', e.ends_at, 'lieu', e.location, 'description', e.description, 'camps', e.camps)
                  from public.events e where e.id::text = p_event),
    'camp', p_camp,
    'equipe', coalesce((select json_agg(json_build_object('id', s.id, 'prenom', s.prenom, 'nom', left(s.nom, 1) || '.', 'classe', s.classe, 'moi', s.id = p_moi) order by s.created_at)
                        from public.event_signups s where s.event_key = p_event and s.camp = p_camp and s.reponse = 'oui'), '[]'),
    'posts', coalesce((select json_agg(json_build_object('id', p.id, 'kind', p.kind, 'auteur', p.auteur_nom, 'mien', p.auteur = p_moi, 'titre', p.titre, 'contenu', p.contenu,
                        'source', p.source, 'reponse', p.reponse, 'retenu', p.retenu, 'date', p.created_at,
                        'votes', (select count(*) from public.camp_votes v where v.post_id = p.id),
                        'mon_vote', exists (select 1 from public.camp_votes v where v.post_id = p.id and v.signup_id = p_moi)) order by p.created_at)
                       from public.camp_posts p where p.event_key = p_event and p.camp = p_camp), '[]'),
    'roles', coalesce((select json_agg(json_build_object('role', r.role, 'prenom', s.prenom, 'moi', r.signup_id = p_moi))
                       from public.camp_roles r join public.event_signups s on s.id = r.signup_id where r.event_key = p_event and r.camp = p_camp), '[]'),
    'roles_liste', public.salle_roles_liste()
  );
$$;
revoke all on function public.salle_contenu(text, text, uuid) from public, anon, authenticated;

create or replace function public.salle_etat(p_jeton uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton);
begin
  return public.salle_contenu(s.event_key, s.camp, s.id)::jsonb || jsonb_build_object('moi', s.prenom);
end $$;

-- Vue bureau (lecture) d'une salle
create or replace function public.salle_etat_bureau(p_event text, p_camp text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_bureau() then raise exception 'acces_refuse'; end if;
  return public.salle_contenu(p_event, p_camp, null)::jsonb || jsonb_build_object('bureau', true);
end $$;

create or replace function public.salle_poster(p_jeton uuid, p_kind text, p_contenu text, p_titre text default null, p_source text default null, p_reponse text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); new_id uuid;
begin
  if p_kind not in ('argument', 'objection', 'message') then raise exception 'type invalide'; end if;
  if (select count(*) from public.camp_posts where auteur = s.id and created_at > now() - interval '1 minute') >= 10 then raise exception 'trop_rapide'; end if;
  insert into public.camp_posts (event_key, camp, kind, auteur, auteur_nom, titre, contenu, source, reponse)
  values (s.event_key, s.camp, p_kind, s.id, s.prenom, nullif(trim(p_titre), ''), trim(p_contenu), nullif(trim(p_source), ''), nullif(trim(p_reponse), ''))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.salle_modifier(p_jeton uuid, p_post uuid, p_champ text, p_valeur text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); p public.camp_posts;
begin
  select * into p from public.camp_posts where id = p_post and event_key = s.event_key and camp = s.camp;
  if not found then raise exception 'acces_refuse'; end if;
  if p_champ = 'retenu' then
    update public.camp_posts set retenu = not retenu where id = p_post;
  elsif p_champ = 'reponse' and p.kind = 'objection' then
    update public.camp_posts set reponse = nullif(trim(left(p_valeur, 3000)), '') where id = p_post;
  elsif p_champ = 'supprimer' and p.auteur = s.id then
    delete from public.camp_posts where id = p_post;
  else
    raise exception 'action_invalide';
  end if;
end $$;

create or replace function public.salle_voter(p_jeton uuid, p_post uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton);
begin
  if not exists (select 1 from public.camp_posts where id = p_post and event_key = s.event_key and camp = s.camp) then raise exception 'acces_refuse'; end if;
  if exists (select 1 from public.camp_votes where post_id = p_post and signup_id = s.id) then
    delete from public.camp_votes where post_id = p_post and signup_id = s.id;
  else
    insert into public.camp_votes (post_id, signup_id) values (p_post, s.id);
  end if;
end $$;

create or replace function public.salle_role(p_jeton uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); r public.camp_roles;
begin
  if not (p_role = any(public.salle_roles_liste())) then raise exception 'role invalide'; end if;
  select * into r from public.camp_roles where event_key = s.event_key and camp = s.camp and role = p_role;
  if found then
    if r.signup_id = s.id then delete from public.camp_roles where event_key = s.event_key and camp = s.camp and role = p_role;
    else raise exception 'role_pris'; end if;
  else
    insert into public.camp_roles (event_key, camp, role, signup_id) values (s.event_key, s.camp, p_role, s.id);
  end if;
end $$;

grant execute on function public.salle_etat(uuid), public.salle_poster(uuid, text, text, text, text, text), public.salle_modifier(uuid, uuid, text, text),
  public.salle_voter(uuid, uuid), public.salle_role(uuid, text) to anon, authenticated;
grant execute on function public.salle_etat_bureau(text, text) to authenticated;
revoke execute on function public.salle_moi(uuid) from public, anon, authenticated;

-- Changement de camp ou « je ne viens pas » : on libère les rôles de prise de parole
create or replace function public.event_signups_liberer_roles() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reponse <> 'oui' or new.camp is distinct from old.camp then delete from public.camp_roles where signup_id = new.id; end if;
  return new;
end $$;
drop trigger if exists event_signups_liberer_roles on public.event_signups;
create trigger event_signups_liberer_roles after update on public.event_signups for each row execute procedure public.event_signups_liberer_roles();

-- La réponse à un événement renvoie aussi le jeton de la salle
create or replace function public.repondre_evenement(
  p_event text, p_reponse text, p_prenom text, p_nom text, p_classe text, p_email text, p_telephone text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.event_signups;
begin
  if p_reponse not in ('oui', 'non') then raise exception 'reponse invalide'; end if;
  if not exists (select 1 from public.events where id::text = p_event and published) then raise exception 'evenement introuvable'; end if;
  if uid is not null then
    select * into r from public.event_signups where event_key = p_event and user_id = uid;
    if found then
      update public.event_signups set reponse = p_reponse where id = r.id returning * into r;
      return json_build_object('statut', 'modifie', 'reponse', r.reponse, 'camp', r.camp, 'jeton', case when r.camp is not null then r.jeton end);
    end if;
  end if;
  begin
    insert into public.event_signups (event_key, reponse, prenom, nom, classe, email, telephone, user_id)
    values (p_event, p_reponse, trim(p_prenom), trim(p_nom), trim(p_classe), lower(trim(p_email)), nullif(trim(p_telephone), ''), uid)
    returning * into r;
  exception when unique_violation then
    return json_build_object('statut', 'deja');
  end;
  return json_build_object('statut', 'ok', 'reponse', r.reponse, 'camp', r.camp, 'jeton', case when r.camp is not null then r.jeton end);
end $$;
alter table public.event_signups add column if not exists lien_envoye_at timestamptz;
-- 009 — Annonce des séances, places par camp, annulation
alter table public.events add column if not exists places_par_camp int check (places_par_camp is null or places_par_camp > 0);
alter table public.events add column if not exists annonce_at timestamptz;
alter table public.events add column if not exists annule_at timestamptz;
alter table public.events add column if not exists annule_motif text check (char_length(annule_motif) <= 1000);

-- Tirage au sort parmi les camps les moins remplis qui ont encore de la place
create or replace function public.tirer_camp(p_event text)
returns text language sql volatile security definer set search_path = public as $$
  with e as (select camps, places_par_camp from public.events where id::text = p_event),
  c as (select unnest(e.camps) as camp from e),
  n as (select c.camp, (select count(*) from public.event_signups s where s.event_key = p_event and s.reponse = 'oui' and s.camp = c.camp) as nb from c),
  libres as (select * from n where (select places_par_camp from e) is null or nb < (select places_par_camp from e))
  select camp from libres where nb = (select min(nb) from libres) order by random() limit 1;
$$;

create or replace function public.event_signups_camp()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  select * into ev from public.events where id::text = new.event_key;
  if new.reponse = 'oui' then
    if ev.annule_at is not null then raise exception 'evenement_annule'; end if;
    if tg_op = 'INSERT' or old.reponse is distinct from 'oui' or new.camp is distinct from old.camp then
      if coalesce(cardinality(ev.camps), 0) > 0 then
        new.camp := public.tirer_camp(new.event_key);
        if new.camp is null then raise exception 'camps_complets'; end if;
      else
        new.camp := null;
      end if;
    end if;
  else
    new.camp := null;
  end if;
  return new;
end $$;

create or replace function public.repondre_evenement(
  p_event text, p_reponse text, p_prenom text, p_nom text, p_classe text, p_email text, p_telephone text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.event_signups;
begin
  if p_reponse not in ('oui', 'non') then raise exception 'reponse invalide'; end if;
  if not exists (select 1 from public.events where id::text = p_event and published) then raise exception 'evenement introuvable'; end if;
  if exists (select 1 from public.events where id::text = p_event and annule_at is not null) then return json_build_object('statut', 'annule'); end if;
  begin
    if uid is not null then
      select * into r from public.event_signups where event_key = p_event and user_id = uid;
      if found then
        update public.event_signups set reponse = p_reponse where id = r.id returning * into r;
        return json_build_object('statut', 'modifie', 'reponse', r.reponse, 'camp', r.camp, 'jeton', r.jeton);
      end if;
    end if;
    insert into public.event_signups (event_key, reponse, prenom, nom, classe, email, telephone, user_id)
    values (p_event, p_reponse, trim(p_prenom), trim(p_nom), trim(p_classe), lower(trim(p_email)), nullif(trim(p_telephone), ''), uid)
    returning * into r;
  exception
    when unique_violation then return json_build_object('statut', 'deja');
    when raise_exception then
      if sqlerrm = 'camps_complets' then return json_build_object('statut', 'complet'); end if;
      raise;
  end;
  return json_build_object('statut', 'ok', 'reponse', r.reponse, 'camp', r.camp, 'jeton', r.jeton);
end $$;
-- 010 — Nombre de camps libre (au moins 2) et nombre d'arguments illimité dans les salles
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%cardinality(camps)%' loop
    execute format('alter table public.events drop constraint %I', c);
  end loop;
end $$;
alter table public.events add constraint events_camps_nombre check (cardinality(camps) = 0 or cardinality(camps) >= 2);

-- Rôles de prise de parole : un rôle « Argument n » par argument retenu (au moins 3), sans plafond
drop function if exists public.salle_roles_liste();
create or replace function public.salle_roles_liste(p_event text, p_camp text) returns text[] language sql stable security definer set search_path = public as $$
  select array['Ouverture']
    || array(select 'Argument ' || g from generate_series(1, greatest(3,
         (select count(*) from public.camp_posts where event_key = p_event and camp = p_camp and kind = 'argument' and retenu)::int)) g)
    || array['Réfutation', 'Conclusion'];
$$;
revoke all on function public.salle_roles_liste(text, text) from public, anon, authenticated;

create or replace function public.salle_contenu(p_event text, p_camp text, p_moi uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'evenement', (select json_build_object('id', e.id, 'titre', e.title, 'type', e.type, 'debut', e.starts_at, 'fin', e.ends_at, 'lieu', e.location, 'description', e.description, 'camps', e.camps)
                  from public.events e where e.id::text = p_event),
    'camp', p_camp,
    'equipe', coalesce((select json_agg(json_build_object('id', s.id, 'prenom', s.prenom, 'nom', left(s.nom, 1) || '.', 'classe', s.classe, 'moi', s.id = p_moi) order by s.created_at)
                        from public.event_signups s where s.event_key = p_event and s.camp = p_camp and s.reponse = 'oui'), '[]'),
    'posts', coalesce((select json_agg(json_build_object('id', p.id, 'kind', p.kind, 'auteur', p.auteur_nom, 'mien', p.auteur = p_moi, 'titre', p.titre, 'contenu', p.contenu,
                        'source', p.source, 'reponse', p.reponse, 'retenu', p.retenu, 'date', p.created_at,
                        'votes', (select count(*) from public.camp_votes v where v.post_id = p.id),
                        'mon_vote', exists (select 1 from public.camp_votes v where v.post_id = p.id and v.signup_id = p_moi)) order by p.created_at)
                       from public.camp_posts p where p.event_key = p_event and p.camp = p_camp), '[]'),
    'roles', coalesce((select json_agg(json_build_object('role', r.role, 'prenom', s.prenom, 'moi', r.signup_id = p_moi))
                       from public.camp_roles r join public.event_signups s on s.id = r.signup_id where r.event_key = p_event and r.camp = p_camp), '[]'),
    'roles_liste', public.salle_roles_liste(p_event, p_camp)
  );
$$;
revoke all on function public.salle_contenu(text, text, uuid) from public, anon, authenticated;

create or replace function public.salle_role(p_jeton uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); r public.camp_roles;
begin
  select * into r from public.camp_roles where event_key = s.event_key and camp = s.camp and role = p_role;
  if found then
    if r.signup_id = s.id then delete from public.camp_roles where event_key = s.event_key and camp = s.camp and role = p_role;
    else raise exception 'role_pris'; end if;
  else
    if not (p_role = any(public.salle_roles_liste(s.event_key, s.camp))) then raise exception 'role invalide'; end if;
    insert into public.camp_roles (event_key, camp, role, signup_id) values (s.event_key, s.camp, p_role, s.id);
  end if;
end $$;

-- Anti-spam seulement (60 messages par minute et par personne), pas de limite de nombre
create or replace function public.salle_poster(p_jeton uuid, p_kind text, p_contenu text, p_titre text default null, p_source text default null, p_reponse text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); new_id uuid;
begin
  if p_kind not in ('argument', 'objection', 'message') then raise exception 'type invalide'; end if;
  if (select count(*) from public.camp_posts where auteur = s.id and created_at > now() - interval '1 minute') >= 60 then raise exception 'trop_rapide'; end if;
  insert into public.camp_posts (event_key, camp, kind, auteur, auteur_nom, titre, contenu, source, reponse)
  values (s.event_key, s.camp, p_kind, s.id, s.prenom, nullif(trim(p_titre), ''), trim(p_contenu), nullif(trim(p_source), ''), nullif(trim(p_reponse), ''))
  returning id into new_id;
  return new_id;
end $$;
-- 011 — Conformité : désinscription des annonces de séances + purge automatique selon les durées annoncées

-- 1. Annonces de séances : chacun peut les refuser
alter table public.adhesions add column if not exists annonces boolean not null default true;
alter table public.adhesions add column if not exists desabo_token uuid not null default gen_random_uuid();
create unique index if not exists adhesions_desabo_token on public.adhesions (desabo_token);

create or replace function public.mes_annonces(p_actif boolean default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare r boolean;
begin
  if auth.uid() is null then raise exception 'non connecte'; end if;
  if p_actif is not null then update public.adhesions set annonces = p_actif where user_id = auth.uid(); end if;
  select annonces into r from public.adhesions where user_id = auth.uid() limit 1;
  return coalesce(r, true);
end $$;
revoke all on function public.mes_annonces(boolean) from public, anon;
grant execute on function public.mes_annonces(boolean) to authenticated;

-- 2. Purge automatique (durées de la politique de confidentialité)
create or replace function public.purge_donnees() returns json language plpgsql volatile security definer set search_path = public, auth as $$
declare
  rentree date := make_date(extract(year from now())::int - case when extract(month from now()) < 9 then 1 else 0 end, 9, 1); -- rentrée en cours
  n_ev int; n_adh int; n_cand int; n_msg int; n_nl int; n_cpt int; n_mm int;
begin
  -- Réponses aux événements et salles de préparation : supprimées 12 mois après l'événement
  with d as (delete from public.camp_roles where event_key in (select id::text from public.events where starts_at < now() - interval '12 months') returning 1) select count(*) into n_ev from d;
  delete from public.camp_posts where event_key in (select id::text from public.events where starts_at < now() - interval '12 months');
  with d as (delete from public.event_signups where event_key in (select id::text from public.events where starts_at < now() - interval '12 months') returning 1) select count(*) into n_ev from d;
  -- Adhésions sans compte : jusqu'à la fin de l'année scolaire suivante
  with d as (delete from public.adhesions where user_id is null and created_at < (rentree - interval '1 year') returning 1) select count(*) into n_adh from d;
  -- Candidatures : 1 an après la décision
  with d as (delete from public.candidatures where decided_at is not null and decided_at < now() - interval '1 year' returning 1) select count(*) into n_cand from d;
  -- Messages de contact : 1 an
  with d as (delete from public.contact_messages where created_at < now() - interval '1 year' returning 1) select count(*) into n_msg from d;
  -- Historique des messages du bureau aux membres : 1 an
  with d as (delete from public.member_messages where created_at < now() - interval '1 year' returning 1) select count(*) into n_mm from d;
  -- Newsletter : inscriptions jamais confirmées (30 jours) et désinscrits (30 jours après)
  with d as (delete from public.newsletter_subscribers where (not confirmed and created_at < now() - interval '30 days') or (unsubscribed_at is not null and unsubscribed_at < now() - interval '30 days') returning 1) select count(*) into n_nl from d;
  -- Comptes : jamais confirmés depuis 30 jours, ou inactifs depuis 3 ans (hors bureau et admin)
  with d as (delete from auth.users u where
      (u.email_confirmed_at is null and u.created_at < now() - interval '30 days')
      or (coalesce(u.last_sign_in_at, u.created_at) < now() - interval '3 years'
          and not exists (select 1 from public.profiles p where p.id = u.id and p.role in ('bureau', 'admin')))
    returning 1) select count(*) into n_cpt from d;
  delete from public.adhesions a where a.user_id is null and a.created_at < now() - interval '3 years';
  return json_build_object('evenements', n_ev, 'adhesions', n_adh, 'candidatures', n_cand, 'contact', n_msg, 'messages_bureau', n_mm, 'newsletter', n_nl, 'comptes', n_cpt);
end $$;
revoke all on function public.purge_donnees() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule('purge-donnees') where exists (select 1 from cron.job where jobname = 'purge-donnees');
select cron.schedule('purge-donnees', '17 3 * * *', 'select public.purge_donnees()');

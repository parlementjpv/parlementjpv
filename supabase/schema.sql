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

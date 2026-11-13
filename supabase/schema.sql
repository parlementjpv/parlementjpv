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

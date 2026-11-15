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
-- 012 — Espace membres : appel en séance (et exclusion automatique), profil d'orateur,
--       banque de motions, élection du bureau à bulletin secret, espace interne du bureau.

-- ───────────────────────── Commun ─────────────────────────
-- Membre = compte connecté, non banni
create or replace function public.est_membre() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not coalesce(banni, false));
$$;

create table if not exists public.reglages (cle text primary key, valeur text not null);
insert into public.reglages (cle, valeur) values ('seuil_absences', '3') on conflict (cle) do nothing;
alter table public.reglages enable row level security;
drop policy if exists "reglages: bureau lit" on public.reglages;
create policy "reglages: bureau lit" on public.reglages for select using (public.is_bureau());
drop policy if exists "reglages: admin modifie" on public.reglages;
create policy "reglages: admin modifie" on public.reglages for update using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Les absences antérieures à cette date ne comptent plus (remise à zéro lors d'un débannissement)
alter table public.profiles add column if not exists absences_depuis timestamptz;

-- ───────────────────────── Appel ─────────────────────────
create table if not exists public.presences (
  event_key         text not null,
  email             text not null,
  user_id           uuid references public.profiles(id) on delete cascade,
  prenom            text not null default '',
  nom               text not null default '',
  classe            text not null default '',
  statut            text not null check (statut in ('present', 'absent', 'excuse')),
  camp              text,
  roles             text[] not null default '{}',
  arguments_retenus int not null default 0,
  pris_le           timestamptz not null default now(),
  primary key (event_key, email)
);
create index if not exists presences_user on public.presences (user_id);
alter table public.presences enable row level security;
drop policy if exists "presences: bureau ou soi" on public.presences;
create policy "presences: bureau ou soi" on public.presences for select using (public.is_bureau() or user_id = auth.uid());

create or replace function public.absences_comptees(p_user uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.presences pr join public.events e on e.id::text = pr.event_key
  where pr.user_id = p_user and pr.statut = 'absent'
    and e.starts_at > coalesce((select absences_depuis from public.profiles where id = p_user), '-infinity'::timestamptz);
$$;

-- Enregistre l'appel d'une séance (appelée par la fonction serveur « appel », après vérification du rôle bureau).
-- p_lignes : [{email, statut, user_id?, prenom?, nom?, classe?}]
create or replace function public.enregistrer_appel(p_event text, p_lignes jsonb)
returns json language plpgsql volatile security definer set search_path = public, auth as $$
declare
  l jsonb; s public.event_signups; uid uuid; seuil int := coalesce((select valeur::int from public.reglages where cle = 'seuil_absences'), 3);
  n int; out jsonb := '[]'; p public.profiles; em text;
begin
  if not exists (select 1 from public.events where id::text = p_event) then raise exception 'evenement introuvable'; end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    em := lower(trim(l->>'email'));
    if (l->>'statut') not in ('present', 'absent', 'excuse') then continue; end if;
    select * into s from public.event_signups where event_key = p_event and lower(email) = em limit 1;
    uid := coalesce(nullif(l->>'user_id', '')::uuid, s.user_id, (select user_id from public.adhesions where lower(email) = em limit 1));
    insert into public.presences (event_key, email, user_id, prenom, nom, classe, statut, camp, roles, arguments_retenus, pris_le)
    values (p_event, em, uid,
      coalesce(s.prenom, l->>'prenom', ''), coalesce(s.nom, l->>'nom', ''), coalesce(s.classe, l->>'classe', ''),
      l->>'statut', s.camp,
      coalesce((select array_agg(r.role order by r.role) from public.camp_roles r where r.signup_id = s.id), '{}'),
      coalesce((select count(*) from public.camp_posts cp where cp.auteur = s.id and cp.kind = 'argument' and cp.retenu), 0),
      now())
    on conflict (event_key, email) do update set statut = excluded.statut, user_id = coalesce(excluded.user_id, presences.user_id),
      camp = excluded.camp, roles = excluded.roles, arguments_retenus = excluded.arguments_retenus, pris_le = now();

    if uid is not null then
      select * into p from public.profiles where id = uid;
      n := public.absences_comptees(uid);
      if l->>'statut' = 'absent' and n > seuil and not p.banni and p.role <> 'admin' then
        update public.profiles set banni = true, role = 'membre', poste = null where id = uid;
        update auth.users set banned_until = now() + interval '100 years' where id = uid;
        out := out || jsonb_build_object('email', em, 'prenom', p.prenom, 'absences', n, 'action', 'exclu');
      elsif l->>'statut' = 'absent' and n = seuil and not p.banni then
        out := out || jsonb_build_object('email', em, 'prenom', p.prenom, 'absences', n, 'action', 'avertissement');
      end if;
    end if;
  end loop;
  return json_build_object('seuil', seuil, 'notifications', out);
end $$;
revoke all on function public.enregistrer_appel(text, jsonb) from public, anon, authenticated;
revoke all on function public.absences_comptees(uuid) from public, anon;
grant execute on function public.absences_comptees(uuid) to authenticated;

-- ───────────────────────── Banque de motions ─────────────────────────
create table if not exists public.motions (
  id         uuid primary key default gen_random_uuid(),
  texte      text not null check (char_length(texte) between 10 and 300),
  contexte   text check (char_length(contexte) <= 1000),
  auteur     uuid references public.profiles(id) on delete set null,
  auteur_nom text not null default '',
  statut     text not null default 'proposee' check (statut in ('proposee', 'retenue', 'debattue', 'ecartee')),
  created_at timestamptz not null default now()
);
create table if not exists public.motion_votes (
  motion_id uuid not null references public.motions(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (motion_id, user_id)
);
alter table public.motions enable row level security;
alter table public.motion_votes enable row level security;
drop policy if exists "motions: membres lisent" on public.motions;
create policy "motions: membres lisent" on public.motions for select using (public.est_membre());
drop policy if exists "motions: bureau gère" on public.motions;
create policy "motions: bureau gère" on public.motions for update using (public.is_bureau());
drop policy if exists "motions: bureau ou auteur supprime" on public.motions;
create policy "motions: bureau ou auteur supprime" on public.motions for delete using (public.is_bureau() or (auteur = auth.uid() and statut = 'proposee'));
drop policy if exists "votes motions: soi" on public.motion_votes;
create policy "votes motions: soi" on public.motion_votes for select using (user_id = auth.uid());

create or replace function public.motion_proposer(p_texte text, p_contexte text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare p public.profiles; id_ uuid;
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  select * into p from public.profiles where id = auth.uid();
  if (select count(*) from public.motions where auteur = p.id and created_at > now() - interval '1 day') >= 5 then raise exception 'trop_de_motions'; end if;
  insert into public.motions (texte, contexte, auteur, auteur_nom) values (trim(p_texte), nullif(trim(p_contexte), ''), p.id, p.prenom || ' ' || left(p.nom, 1) || '.')
  returning id into id_;
  insert into public.motion_votes values (id_, p.id);
  return id_;
end $$;

create or replace function public.motion_voter(p_motion uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  if not exists (select 1 from public.motions where id = p_motion and statut in ('proposee', 'retenue')) then raise exception 'vote_ferme'; end if;
  if exists (select 1 from public.motion_votes where motion_id = p_motion and user_id = auth.uid()) then
    delete from public.motion_votes where motion_id = p_motion and user_id = auth.uid(); return false;
  end if;
  insert into public.motion_votes values (p_motion, auth.uid()); return true;
end $$;

create or replace function public.motions_liste()
returns table (id uuid, texte text, contexte text, auteur_nom text, statut text, created_at timestamptz, votes int, mon_vote boolean, mienne boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.texte, m.contexte, m.auteur_nom, m.statut, m.created_at,
    (select count(*)::int from public.motion_votes v where v.motion_id = m.id),
    exists (select 1 from public.motion_votes v where v.motion_id = m.id and v.user_id = auth.uid()),
    m.auteur = auth.uid()
  from public.motions m where public.est_membre();
$$;
revoke all on function public.motion_proposer(text, text), public.motion_voter(uuid), public.motions_liste() from public, anon;
grant execute on function public.motion_proposer(text, text), public.motion_voter(uuid), public.motions_liste() to authenticated;

-- ───────────────────────── Élections à bulletin secret ─────────────────────────
-- Secret du vote : on enregistre QUI a voté (election_votants) et des COMPTEURS de voix
-- (election_decompte), jamais de lien entre un électeur et son choix. Aucun bulletin individuel n'existe.
create table if not exists public.elections (
  id          uuid primary key default gen_random_uuid(),
  titre       text not null check (char_length(titre) between 3 and 120),
  poste       text,
  description text check (char_length(description) <= 2000),
  ouverture   timestamptz,
  fermeture   timestamptz,
  statut      text not null default 'brouillon' check (statut in ('brouillon', 'ouverte', 'close')),
  publiee     boolean not null default false,
  blancs      int not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.election_candidats (
  id                uuid primary key default gen_random_uuid(),
  election_id       uuid not null references public.elections(id) on delete cascade,
  user_id           uuid references public.profiles(id) on delete set null,
  nom               text not null check (char_length(nom) between 1 and 120),
  profession_de_foi text check (char_length(profession_de_foi) <= 3000),
  ordre             int not null default 0,
  voix              int not null default 0
);
create table if not exists public.election_votants (
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (election_id, user_id)
);
alter table public.elections enable row level security;
alter table public.election_candidats enable row level security;
alter table public.election_votants enable row level security;  -- aucune politique : illisible hors fonctions
drop policy if exists "elections: bureau crée" on public.elections;
create policy "elections: bureau crée" on public.elections for insert with check (public.is_bureau() and statut = 'brouillon' and blancs = 0);
drop policy if exists "elections: bureau modifie brouillon" on public.elections;
create policy "elections: bureau modifie brouillon" on public.elections for update using (public.is_bureau() and statut = 'brouillon') with check (statut = 'brouillon' and blancs = 0);
drop policy if exists "elections: bureau supprime brouillon" on public.elections;
create policy "elections: bureau supprime brouillon" on public.elections for delete using (public.is_bureau() and statut = 'brouillon');
drop policy if exists "candidats: bureau gère en brouillon" on public.election_candidats;
create policy "candidats: bureau gère en brouillon" on public.election_candidats for all
  using (public.is_bureau() and exists (select 1 from public.elections e where e.id = election_id and e.statut = 'brouillon'))
  with check (public.is_bureau() and voix = 0 and exists (select 1 from public.elections e where e.id = election_id and e.statut = 'brouillon'));

-- Électeurs inscrits : membres non bannis dont le compte existait à l'ouverture du vote
create or replace function public.election_inscrits(p_election uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.profiles p join public.elections e on e.id = p_election
  where not coalesce(p.banni, false) and p.created_at < coalesce(e.ouverture, now());
$$;

create or replace function public.election_statut(e public.elections) returns text language sql stable as $$
  select case when e.statut = 'ouverte' and e.fermeture is not null and now() >= e.fermeture then 'close'
              when e.statut = 'ouverte' and e.ouverture is not null and now() < e.ouverture then 'programmee'
              else e.statut end;
$$;

create or replace function public.elections_liste()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]') from (
    select e.id, e.titre, e.poste, e.description, e.ouverture, e.fermeture, e.created_at, public.election_statut(e) as statut, e.publiee,
      exists (select 1 from public.election_votants v where v.election_id = e.id and v.user_id = auth.uid()) as a_vote,
      (select p.created_at < coalesce(e.ouverture, now()) from public.profiles p where p.id = auth.uid()) as peut_voter,
      (e.blancs + coalesce((select sum(c.voix) from public.election_candidats c where c.election_id = e.id), 0))::int as votants,
      public.election_inscrits(e.id) as inscrits,
      (select json_agg(json_build_object('id', c.id, 'nom', c.nom, 'profession_de_foi', c.profession_de_foi, 'user_id', c.user_id,
          'voix', case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then c.voix end) order by c.ordre, c.nom)
       from public.election_candidats c where c.election_id = e.id) as candidats,
      case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then e.blancs end as blancs
    from public.elections e
    where (public.est_membre() and e.statut <> 'brouillon') or public.is_bureau()
  ) x;
$$;

create or replace function public.election_voter(p_election uuid, p_candidat uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare e public.elections;
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  select * into e from public.elections where id = p_election for update;
  if not found or public.election_statut(e) <> 'ouverte' then raise exception 'vote_ferme'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and created_at < coalesce(e.ouverture, now())) then raise exception 'non_inscrit'; end if;
  if p_candidat is not null and not exists (select 1 from public.election_candidats where id = p_candidat and election_id = p_election) then raise exception 'candidat_invalide'; end if;
  begin
    insert into public.election_votants (election_id, user_id) values (p_election, auth.uid());
  exception when unique_violation then raise exception 'deja_vote';
  end;
  if p_candidat is null then update public.elections set blancs = blancs + 1 where id = p_election;
  else update public.election_candidats set voix = voix + 1 where id = p_candidat; end if;
end $$;

create or replace function public.election_action(p_election uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare e public.elections;
begin
  if not public.is_bureau() then raise exception 'reserve_au_bureau'; end if;
  select * into e from public.elections where id = p_election for update;
  if not found then raise exception 'introuvable'; end if;
  if p_action = 'ouvrir' then
    if e.statut <> 'brouillon' then raise exception 'deja_ouverte'; end if;
    if (select count(*) from public.election_candidats where election_id = p_election) < 1 then raise exception 'aucun_candidat'; end if;
    if e.fermeture is null or e.fermeture <= now() then raise exception 'fermeture_invalide'; end if;
    update public.elections set statut = 'ouverte', ouverture = coalesce(ouverture, now()) where id = p_election;
  elsif p_action = 'clore' then
    if e.statut <> 'ouverte' then raise exception 'pas_ouverte'; end if;
    update public.elections set statut = 'close', fermeture = least(coalesce(fermeture, now()), now()) where id = p_election;
  elsif p_action = 'publier' then
    if public.election_statut(e) <> 'close' then raise exception 'pas_close'; end if;
    update public.elections set statut = 'close', publiee = true where id = p_election;
  else raise exception 'action_invalide'; end if;
end $$;
revoke all on function public.elections_liste(), public.election_voter(uuid, uuid), public.election_action(uuid, text), public.election_inscrits(uuid) from public, anon;
grant execute on function public.elections_liste(), public.election_voter(uuid, uuid), public.election_action(uuid, text) to authenticated;

-- ───────────────────────── Profil d'orateur ─────────────────────────
create or replace function public.profil_orateur(p_user uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare u uuid := coalesce(p_user, auth.uid()); p public.profiles; soi boolean;
begin
  if not public.est_membre() and not public.is_bureau() then raise exception 'reserve_aux_membres'; end if;
  select * into p from public.profiles where id = u;
  if not found then return null; end if;
  soi := u = auth.uid() or public.is_bureau();
  return json_build_object(
    'id', p.id, 'prenom', p.prenom, 'nom', case when soi then p.nom else left(p.nom, 1) || '.' end, 'classe', p.classe, 'role', p.role, 'membre_depuis', p.created_at,
    'seances', (select count(*) from public.presences where user_id = u and statut = 'present'),
    'debats', (select count(*) from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u and pr.statut = 'present' and e.type = 'Débat'),
    'roles', coalesce((select json_object_agg(r, n) from (select unnest(roles) r, count(*) n from public.presences where user_id = u and statut = 'present' group by 1) x), '{}'),
    'arguments_retenus', (select coalesce(sum(arguments_retenus), 0) from public.presences where user_id = u and statut = 'present'),
    'camps', coalesce((select json_object_agg(camp, n) from (select camp, count(*) n from public.presences where user_id = u and statut = 'present' and camp is not null group by 1) x), '{}'),
    'motions_proposees', (select count(*) from public.motions where auteur = u),
    'motions_retenues', (select count(*) from public.motions where auteur = u and statut in ('retenue', 'debattue')),
    'votes_elections', case when soi then (select count(*) from public.election_votants where user_id = u) end,
    'absences', case when soi then public.absences_comptees(u) end,
    'excuses', case when soi then (select count(*) from public.presences where user_id = u and statut = 'excuse') end,
    'seuil_absences', case when soi then (select valeur::int from public.reglages where cle = 'seuil_absences') end,
    'historique', case when soi then coalesce((select json_agg(json_build_object('titre', e.title, 'type', e.type, 'date', e.starts_at, 'statut', pr.statut, 'camp', pr.camp, 'roles', pr.roles) order by e.starts_at desc)
                     from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u), '[]') end,
    'moi', u = auth.uid()
  );
end $$;

create or replace function public.orateurs_classement()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.seances desc, x.prenom), '[]') from (
    select p.id, p.prenom, left(p.nom, 1) || '.' as nom, p.classe, p.role,
      count(*) filter (where pr.statut = 'present')::int as seances,
      coalesce(sum(cardinality(pr.roles)) filter (where pr.statut = 'present'), 0)::int as roles
    from public.profiles p join public.presences pr on pr.user_id = p.id
    where not coalesce(p.banni, false) and public.est_membre()
    group by p.id having count(*) filter (where pr.statut = 'present') > 0
  ) x;
$$;
revoke all on function public.profil_orateur(uuid), public.orateurs_classement() from public, anon;
grant execute on function public.profil_orateur(uuid), public.orateurs_classement() to authenticated;

-- ───────────────────────── Espace interne du bureau ─────────────────────────
create table if not exists public.bureau_taches (
  id         uuid primary key default gen_random_uuid(),
  titre      text not null check (char_length(titre) between 2 and 200),
  details    text check (char_length(details) <= 2000),
  assigne_a  uuid references public.profiles(id) on delete set null,
  echeance   date,
  statut     text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'fait')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.bureau_messages (
  id         uuid primary key default gen_random_uuid(),
  auteur     uuid references public.profiles(id) on delete set null default auth.uid(),
  auteur_nom text not null,
  contenu    text not null check (char_length(contenu) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table if not exists public.bureau_notes (
  id         uuid primary key default gen_random_uuid(),
  titre      text not null check (char_length(titre) between 1 and 200),
  contenu    text not null default '' check (char_length(contenu) <= 50000),
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.bureau_taches enable row level security;
alter table public.bureau_messages enable row level security;
alter table public.bureau_notes enable row level security;
drop policy if exists "bureau: taches" on public.bureau_taches;
create policy "bureau: taches" on public.bureau_taches for all using (public.is_bureau()) with check (public.is_bureau());
drop policy if exists "bureau: messages lire" on public.bureau_messages;
create policy "bureau: messages lire" on public.bureau_messages for select using (public.is_bureau());
drop policy if exists "bureau: messages écrire" on public.bureau_messages;
create policy "bureau: messages écrire" on public.bureau_messages for insert with check (public.is_bureau() and auteur = auth.uid());
drop policy if exists "bureau: messages supprimer les siens" on public.bureau_messages;
create policy "bureau: messages supprimer les siens" on public.bureau_messages for delete using (public.is_bureau() and auteur = auth.uid());
drop policy if exists "bureau: notes" on public.bureau_notes;
create policy "bureau: notes" on public.bureau_notes for all using (public.is_bureau()) with check (public.is_bureau());

-- Liste des membres du bureau (pour attribuer les tâches)
create or replace function public.bureau_membres() returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'prenom', prenom, 'nom', nom, 'role', role) order by prenom), '[]')
  from public.profiles where role in ('bureau', 'admin') and public.is_bureau();
$$;
revoke all on function public.bureau_membres() from public, anon;
grant execute on function public.bureau_membres() to authenticated;

-- ───────────────────────── Purge (compléments) ─────────────────────────
create or replace function public.purge_complements() returns void language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.presences where user_id is null and pris_le < now() - interval '12 months';
  delete from public.bureau_messages where created_at < now() - interval '1 year';
  delete from public.election_votants v using public.elections e where e.id = v.election_id and e.statut = 'close' and e.fermeture < now() - interval '30 days';
end $$;
revoke all on function public.purge_complements() from public, anon, authenticated;
select cron.unschedule('purge-complements') where exists (select 1 from cron.job where jobname = 'purge-complements');
select cron.schedule('purge-complements', '27 3 * * *', 'select public.purge_complements()');
create or replace function public.absences_comptees(p_user uuid) returns int language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and p_user <> auth.uid() and not public.is_bureau() then null else (
    select count(*)::int from public.presences pr join public.events e on e.id::text = pr.event_key
    where pr.user_id = p_user and pr.statut = 'absent'
      and e.starts_at > coalesce((select absences_depuis from public.profiles where id = p_user), '-infinity'::timestamptz)) end;
$$;
-- Le bureau voit les brouillons (nécessaire pour les modifier) ; jamais les compteurs d'un vote en cours
drop policy if exists "elections: bureau lit brouillons" on public.elections;
create policy "elections: bureau lit brouillons" on public.elections for select using (public.is_bureau() and statut = 'brouillon');
-- 013 — Postes du bureau (président, etc.) attribués par l'admin, affichés publiquement ; emails de résultats d'élection

alter table public.profiles add column if not exists poste text check (poste is null or poste in ('Président·e', 'Vice-président·e', 'Secrétaire général·e', 'Trésorier·e', 'Responsable Débat', 'Responsable Éloquence', 'Responsable Conférences', 'Responsable Visites', 'Responsable Communication'));
create unique index if not exists profiles_poste_unique on public.profiles (poste) where poste is not null;

-- Un membre ne peut modifier ni son rôle, ni son poste, ni son statut de bannissement, ni son compteur d'absences
drop policy if exists "profil: modification soi-même" on public.profiles;
create policy "profil: modification soi-même" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id
    and role  = (select role  from public.profiles where id = auth.uid())
    and banni = (select banni from public.profiles where id = auth.uid())
    and poste is not distinct from (select poste from public.profiles where id = auth.uid())
    and absences_depuis is not distinct from (select absences_depuis from public.profiles where id = auth.uid()));

-- Bureau affiché publiquement sur « Qui sommes-nous » (prénom, initiale du nom, classe, poste)
create or replace function public.bureau_public()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('poste', poste, 'prenom', prenom, 'nom', left(nom, 1) || '.', 'classe', classe)), '[]')
  from public.profiles where poste is not null and not coalesce(banni, false);
$$;
grant execute on function public.bureau_public() to anon, authenticated;

alter table public.elections add column if not exists resultats_envoyes_at timestamptz;

-- Le poste apparaît à côté des noms
create or replace function public.profil_orateur(p_user uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare u uuid := coalesce(p_user, auth.uid()); p public.profiles; soi boolean;
begin
  if not public.est_membre() and not public.is_bureau() then raise exception 'reserve_aux_membres'; end if;
  select * into p from public.profiles where id = u;
  if not found then return null; end if;
  soi := u = auth.uid() or public.is_bureau();
  return json_build_object(
    'id', p.id, 'prenom', p.prenom, 'nom', case when soi then p.nom else left(p.nom, 1) || '.' end, 'classe', p.classe, 'role', p.role, 'poste', p.poste, 'membre_depuis', p.created_at,
    'seances', (select count(*) from public.presences where user_id = u and statut = 'present'),
    'debats', (select count(*) from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u and pr.statut = 'present' and e.type = 'Débat'),
    'roles', coalesce((select json_object_agg(r, n) from (select unnest(roles) r, count(*) n from public.presences where user_id = u and statut = 'present' group by 1) x), '{}'),
    'arguments_retenus', (select coalesce(sum(arguments_retenus), 0) from public.presences where user_id = u and statut = 'present'),
    'camps', coalesce((select json_object_agg(camp, n) from (select camp, count(*) n from public.presences where user_id = u and statut = 'present' and camp is not null group by 1) x), '{}'),
    'motions_proposees', (select count(*) from public.motions where auteur = u),
    'motions_retenues', (select count(*) from public.motions where auteur = u and statut in ('retenue', 'debattue')),
    'votes_elections', case when soi then (select count(*) from public.election_votants where user_id = u) end,
    'absences', case when soi then public.absences_comptees(u) end,
    'excuses', case when soi then (select count(*) from public.presences where user_id = u and statut = 'excuse') end,
    'seuil_absences', case when soi then (select valeur::int from public.reglages where cle = 'seuil_absences') end,
    'historique', case when soi then coalesce((select json_agg(json_build_object('titre', e.title, 'type', e.type, 'date', e.starts_at, 'statut', pr.statut, 'camp', pr.camp, 'roles', pr.roles) order by e.starts_at desc)
                     from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u), '[]') end,
    'moi', u = auth.uid()
  );
end $$;

create or replace function public.orateurs_classement()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.seances desc, x.prenom), '[]') from (
    select p.id, p.prenom, left(p.nom, 1) || '.' as nom, p.classe, p.role, p.poste,
      count(*) filter (where pr.statut = 'present')::int as seances,
      coalesce(sum(cardinality(pr.roles)) filter (where pr.statut = 'present'), 0)::int as roles
    from public.profiles p join public.presences pr on pr.user_id = p.id
    where not coalesce(p.banni, false) and public.est_membre()
    group by p.id having count(*) filter (where pr.statut = 'present') > 0
  ) x;
$$;

create or replace function public.salle_contenu(p_event text, p_camp text, p_moi uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'evenement', (select json_build_object('id', e.id, 'titre', e.title, 'type', e.type, 'debut', e.starts_at, 'fin', e.ends_at, 'lieu', e.location, 'description', e.description, 'camps', e.camps)
                  from public.events e where e.id::text = p_event),
    'camp', p_camp,
    'equipe', coalesce((select json_agg(json_build_object('id', s.id, 'prenom', s.prenom, 'nom', left(s.nom, 1) || '.', 'classe', s.classe, 'poste', (select pp.poste from public.profiles pp where pp.id = s.user_id), 'moi', s.id = p_moi) order by s.created_at)
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

drop function if exists public.motions_liste();
create or replace function public.motions_liste()
returns table (id uuid, texte text, contexte text, auteur_nom text, statut text, created_at timestamptz, votes int, mon_vote boolean, mienne boolean, auteur_poste text)
language sql stable security definer set search_path = public as $$
  select m.id, m.texte, m.contexte, m.auteur_nom, m.statut, m.created_at,
    (select count(*)::int from public.motion_votes v where v.motion_id = m.id),
    exists (select 1 from public.motion_votes v where v.motion_id = m.id and v.user_id = auth.uid()),
    m.auteur = auth.uid(),
    (select p.poste from public.profiles p where p.id = m.auteur)
  from public.motions m where public.est_membre();
$$;
grant execute on function public.motions_liste() to authenticated;
revoke all on function public.motions_liste() from anon;
revoke all on function public.motions_liste() from public, anon; grant execute on function public.motions_liste() to authenticated;
create or replace function public.bureau_membres() returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'prenom', prenom, 'nom', nom, 'role', role, 'poste', poste) order by prenom), '[]')
  from public.profiles where role in ('bureau', 'admin') and public.is_bureau();
$$;
-- 014 — L'administrateur peut supprimer ou archiver une élection
alter table public.elections add column if not exists archivee boolean not null default false;

create or replace function public.est_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not coalesce(banni, false));
$$;

create or replace function public.election_admin(p_election uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.est_admin() then raise exception 'reserve_admin'; end if;
  if p_action = 'supprimer' then delete from public.elections where id = p_election;
  elsif p_action = 'archiver' then update public.elections set archivee = true where id = p_election;
  elsif p_action = 'desarchiver' then update public.elections set archivee = false where id = p_election;
  else raise exception 'action_invalide'; end if;
  if not found then raise exception 'introuvable'; end if;
end $$;
revoke all on function public.election_admin(uuid, text), public.est_admin() from public, anon;
grant execute on function public.election_admin(uuid, text), public.est_admin() to authenticated;

create or replace function public.elections_liste()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]') from (
    select e.id, e.archivee, e.titre, e.poste, e.description, e.ouverture, e.fermeture, e.created_at, public.election_statut(e) as statut, e.publiee,
      exists (select 1 from public.election_votants v where v.election_id = e.id and v.user_id = auth.uid()) as a_vote,
      (select p.created_at < coalesce(e.ouverture, now()) from public.profiles p where p.id = auth.uid()) as peut_voter,
      (e.blancs + coalesce((select sum(c.voix) from public.election_candidats c where c.election_id = e.id), 0))::int as votants,
      public.election_inscrits(e.id) as inscrits,
      (select json_agg(json_build_object('id', c.id, 'nom', c.nom, 'profession_de_foi', c.profession_de_foi, 'user_id', c.user_id,
          'voix', case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then c.voix end) order by c.ordre, c.nom)
       from public.election_candidats c where c.election_id = e.id) as candidats,
      case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then e.blancs end as blancs
    from public.elections e
    where (public.est_membre() and e.statut <> 'brouillon' and not e.archivee) or public.is_bureau()
  ) x;
$$;

-- 015 — Sauvegarde hebdomadaire (dimanche 4 h 07 UTC) : pg_net appelle la fonction « sauvegarde »
-- avec le secret BACKUP_SECRET (défini dans les secrets Supabase ; non versionné ici).
-- create extension if not exists pg_net;
-- select cron.schedule('sauvegarde-hebdo', '7 4 * * 0', $$select net.http_post(url := '<SUPABASE_URL>/functions/v1/sauvegarde', headers := '{"x-sauvegarde": "<BACKUP_SECRET>", "Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 60000)$$);
-- 016 — Journal des actions du bureau (lisible par l'administrateur uniquement)
create table if not exists public.journal (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  acteur     uuid references public.profiles(id) on delete set null,
  acteur_nom text not null default '',
  categorie  text not null,
  resume     text not null
);
create index if not exists journal_at on public.journal (at desc);
alter table public.journal enable row level security;
drop policy if exists "journal: admin lit" on public.journal;
create policy "journal: admin lit" on public.journal for select using (public.est_admin());

-- Écriture par les fonctions serveur (service) et par les déclencheurs ci-dessous ; jamais directement par le navigateur
create or replace function public.journaliser(p_categorie text, p_resume text, p_acteur uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a uuid := coalesce(p_acteur, auth.uid()); n text;
begin
  if a is null then return; end if;
  select prenom || ' ' || nom into n from public.profiles where id = a;
  insert into public.journal (acteur, acteur_nom, categorie, resume) values (a, coalesce(n, '?'), p_categorie, left(p_resume, 500));
end $$;
revoke all on function public.journaliser(text, text, uuid) from public, anon, authenticated;

-- Déclencheurs : uniquement les modifications faites par un membre du bureau connecté (jamais les votes ni les actions des membres)
create or replace function public.journal_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare r text; t text := tg_table_name; o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  if auth.uid() is null or not public.is_bureau() then return coalesce(new, old); end if;
  if t = 'events' then
    r := case tg_op when 'INSERT' then 'a créé la séance « ' || (n->>'title') || ' »'
                    when 'DELETE' then 'a supprimé la séance « ' || (o->>'title') || ' »'
                    else 'a modifié la séance « ' || (n->>'title') || ' »' end;
    if tg_op = 'UPDATE' and (o->>'annonce_at') is distinct from (n->>'annonce_at') and (o - 'annonce_at' - 'updated_at') = (n - 'annonce_at' - 'updated_at') then return new; end if;
    perform public.journaliser('Séances', r);
  elsif t = 'elections' then
    if tg_op = 'UPDATE' then
      if (o->>'statut') is distinct from (n->>'statut') or (o->>'publiee') is distinct from (n->>'publiee') then
        r := case when (n->>'publiee')::boolean and not (o->>'publiee')::boolean then 'a publié les résultats de « '
                  when n->>'statut' = 'ouverte' then 'a ouvert le vote « ' when n->>'statut' = 'close' then 'a clos le vote « ' else 'a modifié « ' end || (n->>'titre') || ' »';
      elsif (o->>'archivee') is distinct from (n->>'archivee') then
        r := case when (n->>'archivee')::boolean then 'a archivé l''élection « ' else 'a désarchivé l''élection « ' end || (n->>'titre') || ' »';
      elsif (o - 'blancs') <> (n - 'blancs') then r := 'a modifié l''élection « ' || (n->>'titre') || ' »';
      else return new;  -- un vote : jamais journalisé
      end if;
    else
      r := case tg_op when 'INSERT' then 'a créé l''élection « ' || (n->>'titre') || ' »' else 'a supprimé l''élection « ' || (o->>'titre') || ' »' end;
    end if;
    perform public.journaliser('Élections', r);
  elsif t = 'election_candidats' then
    if tg_op = 'UPDATE' then return new; end if;  -- compteurs de voix
    perform public.journaliser('Élections', case tg_op when 'INSERT' then 'a ajouté le candidat ' || (n->>'nom') else 'a retiré le candidat ' || (o->>'nom') end);
  elsif t = 'motions' then
    if tg_op = 'UPDATE' and (o->>'statut') is distinct from (n->>'statut') then
      perform public.journaliser('Motions', 'a passé la motion « ' || left(n->>'texte', 80) || ' » en ' || replace(replace(replace(replace(n->>'statut', 'proposee', 'proposée'), 'retenue', 'retenue'), 'debattue', 'débattue'), 'ecartee', 'écartée'));
    elsif tg_op = 'DELETE' and (o->>'auteur') is distinct from auth.uid()::text then
      perform public.journaliser('Motions', 'a supprimé la motion « ' || left(o->>'texte', 80) || ' »');
    end if;
  elsif t = 'candidatures' and tg_op = 'UPDATE' and (o->>'statut') is distinct from (n->>'statut') then
    perform public.journaliser('Membres', 'a passé la candidature de ' || (n->>'prenom') || ' ' || (n->>'nom') || ' en « ' || (n->>'statut') || ' »');
  elsif t = 'contact_messages' and tg_op = 'UPDATE' and (o->>'traite') is distinct from (n->>'traite') then
    perform public.journaliser('Communication', case when (n->>'traite')::boolean then 'a marqué comme traité le message de ' else 'a rouvert le message de ' end || (n->>'nom'));
  elsif t = 'contact_messages' and tg_op = 'DELETE' then
    perform public.journaliser('Communication', 'a supprimé le message de ' || (o->>'nom'));
  elsif t = 'reglages' and tg_op = 'UPDATE' then
    perform public.journaliser('Réglages', 'a changé le réglage ' || (n->>'cle') || ' : ' || (o->>'valeur') || ' → ' || (n->>'valeur'));
  elsif t = 'adhesions' and tg_op = 'DELETE' then
    perform public.journaliser('Membres', 'a supprimé l''adhésion de ' || (o->>'prenom') || ' ' || (o->>'nom'));
  end if;
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['events', 'elections', 'election_candidats', 'motions', 'candidatures', 'contact_messages', 'reglages', 'adhesions'] loop
    execute format('drop trigger if exists journal_%1$s on public.%1$I', t);
    execute format('create trigger journal_%1$s after insert or update or delete on public.%1$I for each row execute procedure public.journal_trigger()', t);
  end loop;
end $$;

-- Conservation : 1 an
create or replace function public.purge_journal() returns void language sql security definer set search_path = public as $$
  delete from public.journal where at < now() - interval '1 year';
$$;
revoke all on function public.purge_journal() from public, anon, authenticated;
select cron.unschedule('purge-journal') where exists (select 1 from cron.job where jobname = 'purge-journal');
select cron.schedule('purge-journal', '37 3 * * *', 'select public.purge_journal()');
grant execute on function public.journaliser(text, text, uuid) to service_role;
-- 017 — Actualités rédigées depuis l'espace bureau (texte + image)
create table if not exists public.articles (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  titre      text not null check (char_length(titre) between 3 and 160),
  chapo      text check (char_length(chapo) <= 400),
  contenu    text not null default '' check (char_length(contenu) <= 60000),
  image_url  text check (char_length(image_url) <= 500),
  image_alt  text check (char_length(image_alt) <= 200),
  publie     boolean not null default false,
  publie_at  timestamptz,
  auteur     uuid references public.profiles(id) on delete set null,
  auteur_nom text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.articles enable row level security;
drop policy if exists "articles: publiés pour tous" on public.articles;
create policy "articles: publiés pour tous" on public.articles for select using (publie or public.is_bureau());
drop policy if exists "articles: bureau écrit" on public.articles;
create policy "articles: bureau écrit" on public.articles for insert with check (public.is_bureau());
drop policy if exists "articles: bureau modifie" on public.articles;
create policy "articles: bureau modifie" on public.articles for update using (public.is_bureau()) with check (public.is_bureau());
drop policy if exists "articles: bureau supprime" on public.articles;
create policy "articles: bureau supprime" on public.articles for delete using (public.is_bureau());

create or replace function public.articles_maj() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.publie and (tg_op = 'INSERT' or not old.publie) then new.publie_at := coalesce(new.publie_at, now()); end if;
  return new;
end $$;
drop trigger if exists articles_maj on public.articles;
create trigger articles_maj before insert or update on public.articles for each row execute procedure public.articles_maj();

-- Images des articles : stockage public, écriture réservée au bureau (5 Mo max, images seulement)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('articles', 'articles', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists "images articles: bureau ajoute" on storage.objects;
create policy "images articles: bureau ajoute" on storage.objects for insert to authenticated with check (bucket_id = 'articles' and public.is_bureau());
drop policy if exists "images articles: bureau supprime" on storage.objects;
create policy "images articles: bureau supprime" on storage.objects for delete to authenticated using (bucket_id = 'articles' and public.is_bureau());

-- Journal : publication et suppression d'articles
create or replace function public.journal_articles() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_bureau() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then perform public.journaliser('Actualités', 'a créé l''article « ' || new.titre || ' »' || case when new.publie then ' (publié)' else ' (brouillon)' end);
  elsif tg_op = 'DELETE' then perform public.journaliser('Actualités', 'a supprimé l''article « ' || old.titre || ' »');
  elsif new.publie and not old.publie then perform public.journaliser('Actualités', 'a publié l''article « ' || new.titre || ' »');
  elsif old.publie and not new.publie then perform public.journaliser('Actualités', 'a dépublié l''article « ' || new.titre || ' »');
  else perform public.journaliser('Actualités', 'a modifié l''article « ' || new.titre || ' »');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists journal_articles on public.articles;
create trigger journal_articles after insert or update or delete on public.articles for each row execute procedure public.journal_articles();
alter table public.articles add column if not exists categorie text not null default 'Actualité' check (char_length(categorie) <= 40);

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

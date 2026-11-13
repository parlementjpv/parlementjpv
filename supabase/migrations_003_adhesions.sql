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

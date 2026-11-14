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

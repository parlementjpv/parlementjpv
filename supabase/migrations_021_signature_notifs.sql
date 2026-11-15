-- 021 — Signature du membre (certificat) et notifications envoyées par le bureau

create table if not exists public.signatures (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  image     text not null check (image like 'data:image/png;base64,%' and char_length(image) < 150000),
  signed_at timestamptz not null default now()
);
alter table public.signatures enable row level security;
drop policy if exists "signature: lire la sienne" on public.signatures;
create policy "signature: lire la sienne" on public.signatures for select to authenticated using (user_id = auth.uid());
drop policy if exists "signature: créer la sienne" on public.signatures;
create policy "signature: créer la sienne" on public.signatures for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "signature: modifier la sienne" on public.signatures;
create policy "signature: modifier la sienne" on public.signatures for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.notifs_bureau (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  auteur   uuid references public.profiles(id) on delete set null,
  auteur_nom text not null default '',
  titre    text not null check (char_length(titre) between 1 and 80),
  texte    text not null check (char_length(texte) between 1 and 300),
  cible    text not null,
  personnes int not null default 0,
  appareils int not null default 0
);
alter table public.notifs_bureau enable row level security;
drop policy if exists "notifs bureau: lecture bureau" on public.notifs_bureau;
create policy "notifs bureau: lecture bureau" on public.notifs_bureau for select to authenticated using (public.is_bureau());

-- Nombre de membres joignables par notification (pour l'affichage dans l'espace bureau)
create or replace function public.push_stats()
returns json language sql stable security definer set search_path = public as $$
  select case when public.is_bureau() then json_build_object(
    'membres', (select count(distinct a.user_id) from public.push_abonnements a join public.profiles p on p.id = a.user_id where not coalesce(p.banni, false)),
    'appareils', (select count(*) from public.push_abonnements)) end;
$$;
revoke all on function public.push_stats() from public, anon;
grant execute on function public.push_stats() to authenticated;

-- Purge : historique des notifications du bureau gardé 1 an
create or replace function public.purge_notifs_bureau() returns void language sql security definer set search_path = public as $$
  delete from public.notifs_bureau where at < now() - interval '1 year';
$$;

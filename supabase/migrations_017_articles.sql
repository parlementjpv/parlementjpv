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

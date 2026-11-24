-- 028 — Archives PDF chiffrées : un mot de passe différent par archive, visible seulement des administrateurs
-- sur le site (l'email ne contient jamais le mot de passe), et effacé automatiquement au bout d'un an.
create table if not exists public.archives_pdf (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  fichier     text not null,
  documents   int not null default 0,
  destinataire text not null,
  test        boolean not null default false,
  mot_de_passe text not null
);
alter table public.archives_pdf enable row level security;
revoke all on public.archives_pdf from anon, authenticated;
-- Les administrateurs voient la liste sans les mots de passe ; le mot de passe s'obtient par la fonction ci-dessous (journalisée).
grant select (id, created_at, fichier, documents, destinataire, test) on public.archives_pdf to authenticated;
drop policy if exists "archives: admin lit" on public.archives_pdf;
create policy "archives: admin lit" on public.archives_pdf for select to authenticated using (public.est_admin());

create or replace function public.archive_mot_de_passe(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v text; f text; n text;
begin
  if not public.est_admin() then raise exception 'Réservé aux administrateurs'; end if;
  select mot_de_passe, fichier into v, f from public.archives_pdf where id = p_id;
  if v is null then raise exception 'Archive introuvable ou mot de passe expiré'; end if;
  select coalesce(prenom || ' ' || nom, 'Un administrateur') into n from public.profiles where id = auth.uid();
  insert into public.journal (acteur, acteur_nom, categorie, resume) values (auth.uid(), n, 'Téléchargements', 'a affiché le mot de passe de l''archive ' || f);
  return v;
end $$;
revoke all on function public.archive_mot_de_passe(uuid) from public, anon;
grant execute on function public.archive_mot_de_passe(uuid) to authenticated;

-- Effacement au bout d'un an (chaque nuit à 3h37)
create or replace function public.purge_archives_pdf() returns void language sql security definer set search_path = public as $$
  delete from public.archives_pdf where created_at < now() - interval '1 year';
$$;
select cron.unschedule('purge-archives-pdf') where exists (select 1 from cron.job where jobname = 'purge-archives-pdf');
select cron.schedule('purge-archives-pdf', '37 2 * * *', 'select public.purge_archives_pdf()');

-- Envoi : chaque lundi 7h53 (Paris, hiver) ; la fonction n'envoie qu'une semaine sur deux.
select cron.unschedule('archive-pdf') where exists (select 1 from cron.job where jobname = 'archive-pdf');
select cron.schedule('archive-pdf', '53 6 * * 1', $$
  select net.http_post(
    url := 'https://waqaeyclhwhnnmvlfoau.supabase.co/functions/v1/archive-pdf',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sauvegarde', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_secret' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);

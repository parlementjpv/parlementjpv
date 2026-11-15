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

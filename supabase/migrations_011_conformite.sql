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

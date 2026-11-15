-- 022 — Coordonnées (email, téléphone) réservées aux administrateurs
-- Le bureau garde l'accès aux noms, classes, réponses, candidatures… mais plus aux emails ni aux téléphones.
-- Verrou au niveau des colonnes (privilèges PostgreSQL) : même une requête faite à la main est refusée.
-- Les fonctions du serveur (clé de service) et les fonctions « security definer » ne sont pas concernées.

-- Clé pseudonyme pour reconnaître une même personne d'une table à l'autre (appel) sans exposer son email
alter table public.adhesions     add column if not exists email_cle text generated always as (md5(lower(email))) stored;
alter table public.event_signups add column if not exists email_cle text generated always as (md5(lower(email))) stored;
alter table public.presences     add column if not exists email_cle text generated always as (md5(lower(email))) stored;

-- Retire la lecture des colonnes sensibles à tous les rôles du site (visiteurs et connectés)
do $$
declare t text; cols text;
begin
  foreach t in array array['profiles', 'adhesions', 'event_signups', 'candidatures', 'presences', 'newsletter_subscribers'] loop
    execute format('revoke select on public.%I from anon, authenticated', t);
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'public' and table_name = t and column_name not in ('email', 'telephone', 'token', 'confirm_ip', 'desabo_token');
    execute format('grant select (%s) on public.%I to authenticated', cols, t);
  end loop;
end $$;

-- Mes propres coordonnées (formulaires de Mon espace)
create or replace function public.mes_coordonnees()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('email', (select email from auth.users where id = auth.uid()), 'telephone', (select telephone from public.profiles where id = auth.uid()));
$$;

-- Coordonnées de tout le monde : administrateurs uniquement
create or replace function public.coordonnees_admin()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_admin() then raise exception 'reserve_aux_admins'; end if;
  return json_build_object(
    'membres', coalesce((select json_agg(json_build_object('id', p.id, 'email', coalesce(a.email, u.email), 'telephone', coalesce(p.telephone, a.telephone)))
                 from public.profiles p left join auth.users u on u.id = p.id left join public.adhesions a on a.user_id = p.id), '[]'),
    'adhesions', coalesce((select json_agg(json_build_object('id', id, 'email', email, 'telephone', telephone)) from public.adhesions), '[]'),
    'signups', coalesce((select json_agg(json_build_object('id', id, 'email', email, 'telephone', telephone)) from public.event_signups), '[]'),
    'candidatures', coalesce((select json_agg(json_build_object('id', c.id, 'email', c.email, 'telephone', p.telephone)) from public.candidatures c left join public.profiles p on p.id = c.user_id), '[]')
  );
end $$;

create or replace function public.newsletter_export_admin()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_admin() then raise exception 'reserve_aux_admins'; end if;
  return coalesce((select json_agg(json_build_object('email', email, 'confirmed_at', confirmed_at) order by confirmed_at)
    from public.newsletter_subscribers where confirmed and unsubscribed_at is null), '[]');
end $$;

revoke all on function public.mes_coordonnees(), public.coordonnees_admin(), public.newsletter_export_admin() from public, anon;
grant execute on function public.mes_coordonnees(), public.coordonnees_admin(), public.newsletter_export_admin() to authenticated;

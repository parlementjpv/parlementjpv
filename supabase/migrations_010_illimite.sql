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
